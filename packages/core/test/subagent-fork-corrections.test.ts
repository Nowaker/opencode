import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { Message } from "@opencode/ai/effect"
import { Agent } from "@opencode/core/agent"
import { Model } from "@opencode/core/model"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionHistory } from "@opencode/core/session/history"
import { SessionInbox } from "@opencode/core/session/inbox"
import { executeTool, toolIdentity } from "./lib/tool"
import { childID, it, setup } from "./fixture/subagent-options"

for (const switched of [false, true])
  for (const earlier of [false, true]) {
    it.live(
      `R1 preserves native compaction fallback for ${switched ? "a later model switch" : "a cross-model fork"} (earlier checkpoint=${earlier})`,
      () =>
        Effect.gen(function* () {
          const s = yield* setup
          yield* s.sessions.prompt({ sessionID: s.parent.id, text: "irrelevant archive", resume: false })
          yield* SessionInbox.promote(s.db, s.bus, s.parent.id, "steer")
          yield* s.bus.publish(SessionEvent.Compaction.Ended, {
            sessionID: s.parent.id,
            reason: "manual",
            text: "textual boundary",
          })
          yield* s.sessions.prompt({ sessionID: s.parent.id, text: "fallback request", resume: false })
          yield* SessionInbox.promote(s.db, s.bus, s.parent.id, "steer")
          const other = Model.Ref.make({ ...s.model, id: Model.ID.make("child") })
          if (earlier) {
            yield* s.bus.publish(SessionEvent.Compaction.Ended, {
              sessionID: s.parent.id,
              reason: "manual",
              text: "",
              model: other,
              native: { messages: Schema.encodeSync(SessionHistory.NativeWindow)([Message.user("other replacement")]) },
            })
            yield* s.sessions.prompt({ sessionID: s.parent.id, text: "after earlier checkpoint", resume: false })
            yield* SessionInbox.promote(s.db, s.bus, s.parent.id, "steer")
          }
          yield* s.bus.publish(SessionEvent.Compaction.Ended, {
            sessionID: s.parent.id,
            reason: "manual",
            text: "",
            model: s.model,
            native: { messages: Schema.encodeSync(SessionHistory.NativeWindow)([Message.user("native replacement")]) },
          })
          const fork = yield* s.sessions.fork({
            sessionID: s.parent.id,
            child: { title: "Native fork", agent: Agent.ID.make("reviewer"), model: switched ? s.model : other },
          })
          if (switched) {
            expect((yield* SessionHistory.load(s.db, fork.id, s.model)).some(SessionHistory.isNativeCompaction)).toBe(
              true,
            )
            yield* s.sessions.switchModel({ sessionID: fork.id, model: other })
          }
          const history = yield* SessionHistory.load(s.db, fork.id, other)
          expect(history.filter((message) => message.type === "user").map((message) => message.text)).toEqual([
            earlier ? "after earlier checkpoint" : "fallback request",
          ])
          const checkpoint = history.find((message) => message.type === "compaction" && message.status === "completed")
          if (earlier)
            expect(checkpoint?.native?.messages).toEqual(
              Schema.encodeSync(SessionHistory.NativeWindow)([Message.user("other replacement")]),
            )
          if (!earlier) expect(checkpoint?.summary).toBe("textual boundary")
          expect(
            (yield* s.sessions.messages({ sessionID: fork.id, order: "asc" }))
              .filter((message) => message.type === "user")
              .map((message) => message.text),
          ).toEqual(earlier ? ["fallback request", "after earlier checkpoint"] : ["fallback request"])
        }),
    )
  }

it.live("R4 resolves an implicit configured primary for forks and their continuations", () =>
  Effect.gen(function* () {
    const s = yield* setup
    const locations = yield* LocationServiceMap.Service
    const agents = yield* Agent.Service.pipe(Effect.provide(locations.get(s.parent.location)))
    yield* agents.transform((editor) => {
      editor.update(Agent.ID.make("configured-primary"), (agent) => {
        agent.mode = "primary"
      })
      editor.default(Agent.ID.make("configured-primary"))
    })
    const parent = yield* s.sessions.create({ location: s.parent.location, model: s.model })
    yield* s.sessions.synthetic({ sessionID: parent.id, text: "parent context", ignored: true })
    expect(parent.agent).toBeUndefined()
    const call = (input: Record<string, unknown>) =>
      executeTool(s.registry, {
        sessionID: parent.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: crypto.randomUUID(),
          name: "subagent",
          input: { agent: "configured-primary", description: "Implicit primary", prompt: "review", ...input },
        },
      })
    expect(yield* call({})).toMatchObject({ status: "error" })
    const first = yield* call({ fork: true })
    expect(first.status).toBe("completed")
    const id = childID(first.metadata)
    expect(yield* call({ sessionID: id })).toMatchObject({
      status: "completed",
      metadata: { sessionID: id, status: "completed" },
    })
  }),
)
