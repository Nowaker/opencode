import { expect } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { Agent } from "@opencode/core/agent"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { SubagentGroup } from "@opencode/core/session/subagent-group"
import { SubagentJob } from "@opencode/core/session/subagent-job"
import { SubagentTool } from "@opencode/core/tool/plugin/subagent"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { registerToolPlugin } from "./lib/tool"
import { childID, it, setup } from "./fixture/subagent-options"

it.live("R5 rejects a competing group slot before progress, prompt, agent or model mutation", () =>
  Effect.gen(function* () {
    const s = yield* setup
    const locations = yield* LocationServiceMap.Service
    const agents = yield* Agent.Service.pipe(Effect.provide(locations.get(s.parent.location)))
    yield* agents.transform((editor) =>
      editor.update(Agent.ID.make("alternate"), (agent) => {
        agent.mode = "subagent"
        agent.model = Model.Ref.make({ ...s.model, id: Model.ID.make("child") })
      }),
    )
    const child = yield* s.sessions.create({ parentID: s.parent.id, agent: Agent.ID.make("reviewer"), model: s.model })
    const preparing = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const gate = yield* s.llm.gate()
    const notice = yield* s.notice
    const first = yield* s
      .call({ sessionID: child.id, background: true, notice: { group: { id: "race", index: 0, total: 2 } } }, () =>
        Deferred.succeed(preparing, undefined).pipe(Effect.andThen(Deferred.await(release))),
      )
      .pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Deferred.await(preparing)
    const progress: string[] = []
    const loser = yield* s.call(
      {
        sessionID: child.id,
        agent: "alternate",
        background: true,
        notice: { group: { id: "race", index: 1, total: 2 } },
      },
      () =>
        Effect.sync(() => {
          progress.push("loser")
        }),
    )
    expect(loser.status).toBe("error")
    expect(progress).toEqual([])
    expect(yield* s.sessions.get(child.id)).toMatchObject({ agent: child.agent, model: child.model })
    expect(yield* s.sessions.inbox(child.id)).toEqual([])
    yield* Deferred.succeed(release, undefined)
    expect(childID((yield* Fiber.join(first)).metadata)).toBe(child.id)
    yield* gate.started
    yield* gate.release
    yield* Fiber.join(notice)
    yield* s.llm.wait(2)
    yield* s.sessions.wait(s.parent.id)
    expect((yield* SubagentGroup.get(s.db, s.parent.id, "race"))?.slots.map((slot) => slot.status)).toEqual([
      "completed",
      "error",
    ])
    expect((yield* s.sessions.context(s.parent.id)).filter((message) => message.type === "synthetic")).toHaveLength(1)
  }),
)

for (const groupedFirst of [true, false]) {
  it.live(`R5 isolates grouped and ordinary idle-child admission (grouped first=${groupedFirst})`, () =>
    Effect.gen(function* () {
      const s = yield* setup
      const child = yield* s.sessions.create({
        parentID: s.parent.id,
        agent: Agent.ID.make("reviewer"),
        model: s.model,
      })
      const preparing = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const gate = yield* s.llm.gate()
      const group = { group: { id: "mixed", index: 0, total: 1 } }
      const first = yield* s
        .call({ sessionID: child.id, background: true, ...(groupedFirst ? { notice: group } : {}) }, () =>
          Deferred.succeed(preparing, undefined).pipe(Effect.andThen(Deferred.await(release))),
        )
        .pipe(Effect.forkScoped({ startImmediately: true }))
      yield* Deferred.await(preparing)
      const progress: string[] = []
      const second = s.call(
        {
          sessionID: child.id,
          background: true,
          prompt: "must not be admitted",
          ...(groupedFirst ? {} : { notice: group }),
        },
        () =>
          Effect.sync(() => {
            progress.push("loser")
          }),
      )
      if (groupedFirst) expect((yield* second).status).toBe("error")
      const competing = groupedFirst ? undefined : yield* second.pipe(Effect.forkScoped({ startImmediately: true }))
      if (!groupedFirst)
        yield* SubagentGroup.get(s.db, s.parent.id, "mixed").pipe(
          Effect.repeat({ until: (state) => state?.slots[0]?.childSessionID === child.id }),
          Effect.timeout("5 seconds"),
        )
      yield* Deferred.succeed(release, undefined)
      expect((yield* Fiber.join(first)).metadata).toEqual({ sessionID: child.id, status: "running" })
      if (competing) expect((yield* Fiber.join(competing)).status).toBe("error")
      expect(progress).toEqual([])
      expect(yield* s.sessions.get(child.id)).toMatchObject({ agent: child.agent, model: child.model })
      yield* gate.started
      if (groupedFirst)
        expect((yield* s.call({ sessionID: child.id, background: true, prompt: "steer" })).metadata).toEqual({
          sessionID: child.id,
          status: "running",
        })
      yield* gate.release
      yield* s.jobs.wait({ id: child.id })
      yield* s.jobs.pendingBackground.pipe(
        Effect.repeat({ until: (rows) => rows.length === 0 }),
        Effect.timeout("5 seconds"),
      )
      yield* s.sessions.wait(s.parent.id)
      expect(
        (yield* s.sessions.context(child.id))
          .filter((message) => message.type === "user")
          .map((message) => message.text),
      ).toEqual(groupedFirst ? ["review", "steer"] : ["review"])
      expect((yield* SubagentGroup.get(s.db, s.parent.id, "mixed"))?.slots[0]?.status).toBe(
        groupedFirst ? "completed" : "error",
      )
    }),
  )
}

it.live("F1 rejects an initially idle ordinary call when a group wins its pre-lock gap", () =>
  Effect.gen(function* () {
    const s = yield* setup
    const locations = yield* LocationServiceMap.Service
    const beforeLock = yield* Deferred.make<void>()
    const enterLock = yield* Deferred.make<void>()
    const groupProgress = yield* Deferred.make<void>()
    const launchGroup = yield* Deferred.make<void>()
    const firstAdmission = { pending: true }
    yield* Effect.gen(function* () {
      const subagents = yield* SubagentJob.Service
      const hooks = yield* PluginHooks.Service
      const agents = yield* Agent.Service
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("alternate"), (agent) => {
          agent.mode = "subagent"
          agent.model = Model.Ref.make({ ...s.model, id: Model.ID.make("alternate") })
        }),
      )
      yield* registerToolPlugin(SubagentTool.Plugin, {}, (name, callback) =>
        hooks.register("tool", name, callback),
      ).pipe(
        Effect.provideService(SubagentJob.Service, {
          ...subagents,
          admit: (id, launch) =>
            Effect.suspend(() => {
              if (!firstAdmission.pending) return subagents.admit(id, launch)
              firstAdmission.pending = false
              return Deferred.succeed(beforeLock, undefined).pipe(
                Effect.andThen(Deferred.await(enterLock)),
                Effect.andThen(subagents.admit(id, launch)),
              )
            }),
        }),
      )
    }).pipe(Effect.provide(locations.get(s.parent.location)))
    const child = yield* s.sessions.create({ parentID: s.parent.id, agent: Agent.ID.make("reviewer"), model: s.model })
    const ordinaryProgress: string[] = []
    const ordinary = yield* s
      .call({ sessionID: child.id, agent: "alternate", background: true, prompt: "must stay unadmitted" }, () =>
        Effect.sync(() => {
          ordinaryProgress.push("ordinary")
        }),
      )
      .pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Deferred.await(beforeLock)
    const gate = yield* s.llm.gate()
    const grouped = yield* s
      .call({ sessionID: child.id, background: true, notice: { group: { id: "prelock", index: 0, total: 1 } } }, () =>
        Deferred.succeed(groupProgress, undefined).pipe(Effect.andThen(Deferred.await(launchGroup))),
      )
      .pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Deferred.await(groupProgress)
    yield* Deferred.succeed(enterLock, undefined)
    yield* Deferred.succeed(launchGroup, undefined)
    expect((yield* Fiber.join(grouped)).metadata).toEqual({ sessionID: child.id, status: "running" })
    expect((yield* Fiber.join(ordinary)).status).toBe("error")
    expect(ordinaryProgress).toEqual([])
    expect(yield* s.sessions.get(child.id)).toMatchObject({ agent: child.agent, model: child.model })
    yield* gate.started
    expect(
      (yield* s.sessions.context(child.id)).filter((message) => message.type === "user").map((message) => message.text),
    ).toEqual(["review"])
    expect((yield* s.sessions.inbox(child.id)).filter((item) => item.type === "user")).toEqual([])
    yield* gate.release
    yield* s.jobs.wait({ id: child.id })
  }),
)
