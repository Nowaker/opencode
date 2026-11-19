import { expect } from "bun:test"
import { Database } from "@opencode/core/database/database"
import { EngineStop } from "@opencode/core/engine-stop"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Job } from "@opencode/core/job"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SubagentCompletion } from "@opencode/core/session/subagent-completion"
import { SubagentGroup } from "@opencode/core/session/subagent-group"
import { SessionMessage } from "@opencode/schema/session-message"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Cause, Effect, Exit } from "effect"
import { forceInput, reopen, seal } from "./fixture/engine-stop"
import { owner, ownerGraph, ownerReplacements } from "./fixture/engine-stop-owner"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([ownerGraph, Job.node, EngineStop.node, SessionInbox.node]), ownerReplacements))

for (const notice of ["each", "none"] as const) {
  it.live(`retains sealed ${notice} subagent delivery without acknowledgement and retries after reopen`, () =>
    Effect.gen(function* () {
      const s = yield* owner
      const claims = yield* EngineStop.Service
      const jobs = yield* Job.Service
      const database = yield* Database.Service
      const inbox = yield* SessionInbox.Service
      const notificationID = SessionMessage.ID.create()
      const recovery = {
        kind: "subagent" as const, parentSessionID: s.sessionID, childSessionID: s.sessionID,
        agent: "general", description: "Owed completion", notice,
      }
      yield* jobs.start({ id: "owed", type: "subagent", recovery, notificationID, run: Effect.succeed("finished") })
      yield* jobs.wait({ id: "owed" })
      yield* jobs.background("owed")
      const before = yield* s.sequence
      const operation = yield* seal(claims)
      const input = { status: "completed" as const, output: "finished", notificationID, recovery, db: database.db, resume: false }
      const result = yield* SubagentCompletion.deliver(s.sessions, jobs, input).pipe(Effect.exit)
      expect(Exit.isFailure(result) ? Cause.squash(result.cause) : result).toMatchObject({
        _tag: "EngineStop.RefusedError", admission: { status: "not-admitted" },
      })
      expect((yield* jobs.pendingBackground).map((job) => job.notificationID)).toEqual([notificationID])
      expect(yield* s.sequence).toBe(before)
      yield* reopen(claims, operation)
      yield* SubagentCompletion.deliver(s.sessions, jobs, input)
      expect(yield* jobs.pendingBackground).toEqual([])
      expect((yield* inbox.list(s.sessionID)).map((item) => item.id)).toEqual(notice === "each" ? [notificationID] : [])
    }),
  )
}

it.live("refuses a sealed grouped completion before its slot update and delivers the owed group after reopen", () =>
  Effect.gen(function* () {
    const s = yield* owner
    const claims = yield* EngineStop.Service
    const jobs = yield* Job.Service
    const database = yield* Database.Service
    const inbox = yield* SessionInbox.Service
    const group = yield* SubagentGroup.register(database.db, {
      parentSessionID: s.sessionID, group: { id: "owed", index: 0, total: 1 }, description: "Review", agent: "general",
    })
    const recovery = {
      kind: "subagent" as const, parentSessionID: s.sessionID, childSessionID: s.sessionID,
      agent: "general", description: "Review", group,
    }
    yield* jobs.start({ id: "group", type: "subagent", recovery, notificationID: group.generation, run: Effect.succeed("review") })
    yield* jobs.wait({ id: "group" })
    yield* jobs.background("group")
    const before = yield* SubagentGroup.get(database.db, s.sessionID, group.id)
    const operation = yield* seal(claims)
    const input = { status: "completed" as const, output: "review", notificationID: group.generation, recovery, db: database.db, resume: false }
    yield* SubagentCompletion.deliver(s.sessions, jobs, input).pipe(Effect.exit)
    expect(yield* SubagentGroup.get(database.db, s.sessionID, group.id)).toEqual(before)
    expect((yield* jobs.pendingBackground).map((job) => job.notificationID)).toEqual([group.generation])
    expect(yield* inbox.list(s.sessionID)).toEqual([])
    yield* reopen(claims, operation)
    yield* SubagentCompletion.deliver(s.sessions, jobs, input)
    expect((yield* SubagentGroup.get(database.db, s.sessionID, group.id))?.delivered).toBe(true)
    expect((yield* inbox.list(s.sessionID)).map((item) => item.id)).toEqual([group.notificationID])
    expect(yield* jobs.pendingBackground).toEqual([])
  }),
)

it.live("borrows live settlement ownership for completion after force closes fresh admission", () =>
  Effect.gen(function* () {
    const s = yield* owner
    const claims = yield* EngineStop.Service
    const jobs = yield* Job.Service
    const database = yield* Database.Service
    const inbox = yield* SessionInbox.Service
    const notificationID = SessionMessage.ID.create()
    yield* claims.withWork(Effect.gen(function* () {
      yield* claims.prepare(yield* forceInput(claims))
      yield* SubagentCompletion.deliver(s.sessions, jobs, {
        status: "completed", notificationID, output: "settled", resume: false, db: database.db,
        recovery: { kind: "subagent", parentSessionID: s.sessionID, childSessionID: s.sessionID, agent: "general", description: "Owned" },
      })
    }), Effect.void)
    expect((yield* inbox.list(s.sessionID)).map((item) => item.id)).toEqual([notificationID])
  }),
)
