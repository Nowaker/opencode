import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Fiber } from "effect"
import { Job } from "@opencode/core/job"
import { JobTable } from "@opencode/core/job/sql"
import { KVTable } from "@opencode/core/kv/sql"
import { SessionMessage } from "@opencode/core/session/message"
import { Session } from "@opencode/core/session"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { SessionStore } from "@opencode/core/session/store"
import { SubagentGroup } from "@opencode/core/session/subagent-group"
import { it, setup } from "./fixture/subagent-options"

describe("durable subagent groups", () => {
  for (const [parentID, otherID] of [
    ["ses_group_%", "ses_group_abc"],
    ["ses_group_a_b", "ses_group_axb"],
    ["ses_group", "ses_group/nested"],
  ] as const) {
    it.live(`removes only an exact parent prefix when its id contains ${parentID}`, () =>
      Effect.gen(function* () {
        const s = yield* setup
        const parent = yield* s.sessions.create({ id: Session.ID.make(parentID), location: s.parent.location })
        const other = yield* s.sessions.create({ id: Session.ID.make(otherID), location: s.parent.location })
        const register = (id: Session.ID) =>
          SubagentGroup.register(s.db, {
            parentSessionID: id,
            group: { id: "review", index: 0, total: 1 },
            description: "Review",
            agent: "reviewer",
          })
        yield* register(parent.id)
        const survivor = yield* register(other.id)
        yield* SubagentGroup.remove(s.db, parent.id)
        expect((yield* SubagentGroup.get(s.db, other.id, "review"))?.notificationID).toBe(survivor.notificationID)
      }),
    )
  }
  it.live("registers concurrent fixed slots atomically and rejects conflicting or duplicate invocation", () =>
    Effect.gen(function* () {
      const s = yield* setup
      const register = (index: number, total = 2) =>
        SubagentGroup.register(s.db, {
          parentSessionID: s.parent.id,
          group: { id: "review", index, total },
          description: "Review",
          agent: "reviewer",
        })
      const slots = yield* Effect.all([register(0), register(1)], { concurrency: "unbounded" })
      expect(
        (yield* SubagentGroup.get(s.db, s.parent.id, "review"))?.slots.map((slot) => slot.index).toSorted(),
      ).toEqual([0, 1])
      expect((yield* register(0).pipe(Effect.flip))._tag).toBe("SubagentGroup.Conflict")
      expect((yield* register(1, 3).pipe(Effect.flip))._tag).toBe("SubagentGroup.Conflict")
      expect((yield* register(2).pipe(Effect.flip))._tag).toBe("SubagentGroup.Conflict")
      const other = yield* s.sessions.create({ location: s.parent.location })
      const independent = yield* SubagentGroup.register(s.db, {
        parentSessionID: other.id,
        group: { id: "review", index: 0, total: 2 },
        description: "Other review",
        agent: "reviewer",
      })
      expect(independent.notificationID).not.toBe(slots[0]?.notificationID)
      const token = slots[0]
      if (!token) return yield* Effect.die("Missing registered slot")
      yield* SubagentGroup.update(s.db, { ...token, generation: SessionMessage.ID.create() }, { status: "error" })
      expect(
        (yield* SubagentGroup.get(s.db, s.parent.id, "review"))?.slots.every((slot) => slot.status === "running"),
      ).toBe(true)
    }),
  )

  it.live("recovers prelaunch cancellation and replays a crash after notice admission exactly once", () =>
    Effect.gen(function* () {
      const s = yield* setup
      const notice = yield* s.notice
      const register = (index: number) =>
        SubagentGroup.register(s.db, {
          parentSessionID: s.parent.id,
          group: { id: "restart", index, total: 2 },
          description: "Restart review",
          agent: "reviewer",
        })
      yield* register(0)
      const failed = yield* register(1)
      yield* SubagentGroup.update(s.db, failed, { status: "error", error: "Model unavailable" })
      const restart = yield* SessionRestart.Service
      yield* restart.resumeSuspendedSessions
      yield* Fiber.join(notice)
      yield* s.llm.wait(1)
      yield* s.sessions.wait(s.parent.id)
      const state = yield* SubagentGroup.get(s.db, s.parent.id, "restart")
      expect(state?.slots.map((slot) => slot.status)).toEqual(["cancelled", "error"])
      expect(state?.delivered).toBe(true)
      const admitted = (yield* s.sessions.context(s.parent.id)).filter((message) => message.type === "synthetic")
      expect(admitted).toMatchObject([{ type: "synthetic", id: state?.notificationID }])
      expect(yield* s.llm.requests()).toHaveLength(1)
      const rows = yield* s.db.select().from(KVTable).all()
      const stored = rows.find((row) => JSON.stringify(row.value).includes(failed.notificationID))
      if (!stored || !state) return yield* Effect.die("Missing durable group")
      yield* s.db
        .update(KVTable)
        .set({ value: { ...state, delivered: false } })
        .where(eq(KVTable.key, stored.key))
        .run()
      const freshJobs = yield* Job.make
      yield* SessionRestart.Service.use((service) => service.resumeSuspendedSessions).pipe(
        Effect.provide(SessionRestart.layer()),
        Effect.provideService(Job.Service, freshJobs),
      )
      expect((yield* s.sessions.context(s.parent.id)).filter((message) => message.type === "synthetic")).toEqual(admitted)
      expect(yield* s.llm.requests()).toHaveLength(1)
      expect(yield* SubagentGroup.pending(s.db)).toEqual([])
      expect(
        (yield* SubagentGroup.register(s.db, {
          parentSessionID: s.parent.id,
          group: { id: "restart", index: 0, total: 2 },
          description: "Retry",
          agent: "reviewer",
        }).pipe(Effect.flip))._tag,
      ).toBe("SubagentGroup.Conflict")
    }),
  )

  for (const status of ["completed", "running"] as const) {
    it.live(`recovers a ${status} silent child without a parent completion`, () =>
      Effect.gen(function* () {
        const s = yield* setup
        const child = yield* s.sessions.create({ parentID: s.parent.id, model: s.model })
        const id = SessionMessage.ID.create()
        if (status === "running") {
          const store = yield* SessionStore.Service
          yield* store.claim(child.id)
          yield* s.sessions.prompt({ sessionID: child.id, text: "continue", resume: false })
        }
        yield* s.db
          .insert(JobTable)
          .values({
            notification_id: id,
            id: child.id,
            session_id: s.parent.id,
            child_session_id: child.id,
            kind: "subagent",
            status,
            output: "recovered output",
            recovery: {
              kind: "subagent",
              parentSessionID: s.parent.id,
              childSessionID: child.id,
              agent: "reviewer",
              description: "silent",
              notice: "none",
            },
          })
          .run()
        const restart = yield* SessionRestart.Service
        yield* restart.resumeSuspendedSessions
        yield* s.sessions.wait(child.id)
        yield* s.jobs.pendingBackground.pipe(
          Effect.repeat({ until: (rows) => rows.length === 0 }),
          Effect.timeout("5 seconds"),
        )
        expect((yield* s.sessions.inbox(s.parent.id)).filter((item) => item.type === "synthetic")).toEqual([])
        expect((yield* s.sessions.context(s.parent.id)).filter((item) => item.type === "synthetic")).toEqual([])
      }),
    )
  }

  it.live("settles recovered durable child outcomes into their original group generation", () =>
    Effect.gen(function* () {
      const s = yield* setup
      const token = yield* SubagentGroup.register(s.db, {
        parentSessionID: s.parent.id,
        group: { id: "child-recovery", index: 0, total: 1 },
        description: "Review",
        agent: "reviewer",
      })
      const child = yield* s.sessions.create({ parentID: s.parent.id, model: s.model })
      yield* SubagentGroup.update(s.db, token, { status: "running", childSessionID: child.id })
      yield* s.db
        .insert(JobTable)
        .values({
          notification_id: token.generation,
          id: child.id,
          session_id: s.parent.id,
          child_session_id: child.id,
          kind: "subagent",
          status: "completed",
          output: "durable child result",
          recovery: {
            kind: "subagent",
            parentSessionID: s.parent.id,
            childSessionID: child.id,
            agent: "reviewer",
            description: "Review",
            group: token,
          },
        })
        .run()
      const restart = yield* SessionRestart.Service
      yield* restart.resumeSuspendedSessions
      yield* s.sessions.wait(s.parent.id)
      expect(
        (yield* s.sessions.inbox(s.parent.id)).length +
          (yield* s.sessions.context(s.parent.id)).filter((m) => m.type === "synthetic").length,
      ).toBe(1)
      expect((yield* SubagentGroup.get(s.db, s.parent.id, token.id))?.slots).toMatchObject([
        { status: "completed", output: "durable child result" },
      ])
      expect(yield* s.jobs.pendingBackground).toEqual([])
      yield* restart.resumeSuspendedSessions
      expect(yield* SubagentGroup.pending(s.db)).toEqual([])
    }),
  )
})
