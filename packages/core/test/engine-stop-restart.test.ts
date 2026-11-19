import { expect } from "bun:test"
import { EngineStop } from "@opencode/core/engine-stop"
import { Database } from "@opencode/core/database/database"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { SessionStore } from "@opencode/core/session/store"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionTable } from "@opencode/core/session/sql"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { childCancellationLayer, childFixture } from "./fixture/child-cancellation"
import { reopen, seal } from "./fixture/engine-stop"
import { testEffect } from "./lib/effect"

const it = testEffect(childCancellationLayer)

it.live("sealed recovery leaves a pending child marker and job owed without dying", () =>
  Effect.gen(function* () {
    const s = yield* childFixture
    const claims = yield* EngineStop.Service
    const store = yield* SessionStore.Service
    const database = yield* Database.Service
    const restart = yield* SessionRestart.Service
    yield* store.claim(s.child.id)
    const marker = database.db.select({ claim: SessionTable.time_suspended })
      .from(SessionTable).where(eq(SessionTable.id, s.child.id)).get()
    const before = yield* marker
    expect(before?.claim).toBeNumber()
    yield* s.jobs.start({ id: s.child.id, type: "subagent", recovery: s.recovery, run: Effect.never })
    yield* s.jobs.background(s.child.id)
    const pending = yield* s.jobs.pendingBackground
    expect((yield* seal(claims)).status).toBe("sealed")
    yield* restart.resumeSuspendedSessions
    expect(yield* s.jobs.pendingBackground).toEqual(pending)
    expect(yield* marker).toEqual(before)
  }),
)

it.live("sealed recovery preserves an orphaned child's own marker before cleanup", () =>
  Effect.gen(function* () {
    const s = yield* childFixture
    const claims = yield* EngineStop.Service
    const store = yield* SessionStore.Service
    const database = yield* Database.Service
    const restart = yield* SessionRestart.Service
    yield* store.claim(s.child.id)
    const marker = database.db.select({ claim: SessionTable.time_suspended })
      .from(SessionTable).where(eq(SessionTable.id, s.child.id)).get()
    const before = yield* marker
    expect(before?.claim).toBeNumber()
    expect(yield* s.jobs.pendingBackground).toEqual([])
    expect((yield* seal(claims)).status).toBe("sealed")
    yield* restart.resumeSuspendedSessions
    expect(yield* marker).toEqual(before)
  }),
)

it.live("sealed restart leaves completion unacknowledged and delivers it after cancellation", () =>
  Effect.gen(function* () {
    const s = yield* childFixture
    const claims = yield* EngineStop.Service
    const restart = yield* SessionRestart.Service
    const inbox = yield* SessionInbox.Service
    yield* s.jobs.start({ id: s.child.id, type: "subagent", recovery: s.recovery, run: Effect.succeed("recovered completion") })
    yield* s.jobs.wait({ id: s.child.id })
    yield* s.jobs.background(s.child.id)
    const pending = yield* s.jobs.pendingBackground
    const operation = yield* seal(claims)
    yield* restart.resumeSuspendedSessions
    expect(yield* s.jobs.pendingBackground).toEqual(pending)
    expect(yield* inbox.list(s.parent.id)).toEqual([])
    yield* reopen(claims, operation)
    yield* restart.resumeSuspendedSessions
    expect(yield* s.jobs.pendingBackground).toEqual([])
    expect((yield* inbox.list(s.parent.id)).map((item) => item.id)).toEqual(pending.map((job) => job.notificationID))
  }),
)
