import { expect } from "bun:test"
import { Effect, Fiber, Scope } from "effect"
import { TestLLM } from "@opencode/ai/testing"
import { JobTable } from "@opencode/core/job/sql"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { SessionStore } from "@opencode/core/session/store"
import { SessionMessage } from "@opencode/core/session/message"
import { Agent } from "@opencode/core/agent"
import { childID, it, setup } from "./fixture/subagent-options"

for (const mode of ["new", "resume", "restart"] as const) {
  it.live(`R3 reads the final post-prompt answer beyond twenty messages (mode=${mode})`, () =>
    Effect.gen(function* () {
      const s = yield* setup
      const locations = yield* LocationServiceMap.Service
      const hooks = yield* PluginHooks.Service.pipe(Effect.provide(locations.get(s.parent.location)))
      const scope = yield* Effect.scope
      yield* s.llm.push(...Array.from({ length: 26 }, (_, index) => TestLLM.text(`answer ${index}`, `reply-${index}`)))
      const install = (id: typeof s.parent.id) => {
        const remaining = { value: 25 }
        return hooks
          .register("session", "experimental.idle", (event) =>
            Effect.gen(function* () {
              if (event.sessionID !== id || remaining.value-- <= 0) return
              yield* s.sessions.synthetic({ sessionID: id, text: "Continue the fixture" }).pipe(Effect.orDie)
            }),
          )
          .pipe(Effect.provideService(Scope.Scope, scope))
      }
      if (mode !== "restart") {
        yield* s.sessions.synthetic({ sessionID: s.parent.id, text: "inherited context", ignored: true })
        const fork =
          mode === "resume"
            ? yield* s.sessions.fork({
                sessionID: s.parent.id,
                child: { title: "Resumed output", agent: Agent.ID.make("reviewer"), model: s.model },
              })
            : undefined
        const result = yield* s.call(fork ? { sessionID: fork.id } : { fork: true }, (update) =>
          install(childID(update)).pipe(Effect.asVoid),
        )
        expect(result.content).toEqual([
          {
            type: "text",
            text: `<subagent sessionID="${childID(result.metadata)}" state="completed">\nanswer 25\n</subagent>`,
          },
        ])
        return
      }
      const child = yield* s.sessions.create({ parentID: s.parent.id, model: s.model })
      const prompt = yield* s.sessions.prompt({ sessionID: child.id, text: "recovered request", resume: false })
      yield* install(child.id)
      const store = yield* SessionStore.Service
      yield* store.claim(child.id)
      const notice = yield* s.notice
      yield* s.db
        .insert(JobTable)
        .values({
          notification_id: SessionMessage.ID.create(),
          id: child.id,
          session_id: s.parent.id,
          child_session_id: child.id,
          kind: "subagent",
          status: "running",
          recovery: {
            kind: "subagent",
            parentSessionID: s.parent.id,
            childSessionID: child.id,
            agent: "reviewer",
            description: "Recovered output",
            after: prompt.id,
          },
        })
        .run()
      const service = yield* SessionRestart.Service
      yield* service.resumeSuspendedSessions
      const events = Array.from(yield* Fiber.join(notice))
      const item = events[0]?.data.item
      if (item?.type !== "synthetic") return yield* Effect.die("Missing recovered completion")
      expect(item.payload.text).toContain("\nanswer 25\n")
    }),
  )
}
