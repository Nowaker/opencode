export * as SessionChildCancellation from "./child-cancellation.js"

import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Cancellation } from "../cancellation.js"
import { Database } from "../database/database.js"
import { Job } from "../job.js"
import { JobTable } from "../job/sql.js"
import { NotFoundError, ParentMismatchError } from "./error.js"
import { SessionExecution } from "./execution.js"
import { SessionSchema } from "./schema.js"
import { SessionTable } from "./sql.js"

/** Captures the host scope so an acknowledged stop survives a caller's deadline or disconnect. */
export const make = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  const jobs = yield* Job.Service
  const execution = yield* SessionExecution.Service
  const settle = yield* Cancellation.make

  const snapshot = Effect.fnUntraced(function* (input: SessionSchema.CancelChildInput) {
    const row = yield* db
      .select({
        parentID: SessionTable.parent_id,
        claim: SessionTable.time_suspended,
        outcome: SessionTable.idle_outcome,
        busy: SessionTable.time_busy,
        idle: SessionTable.time_idle,
      })
      .from(SessionTable)
      .where(eq(SessionTable.id, input.sessionID))
      .get()
      .pipe(Effect.orDie)
    if (!row) return yield* new NotFoundError({ sessionID: input.sessionID })
    if (row.parentID !== input.parentID) return yield* new ParentMismatchError(input)
    const job = yield* jobs.get(input.sessionID)
    const durable = yield* db
      .select({ status: JobTable.status, updated: JobTable.time_updated })
      .from(JobTable)
      .where(eq(JobTable.child_session_id, input.sessionID))
      .all()
      .pipe(Effect.orDie)
    const active = yield* execution.isActive(input.sessionID)
    return { row, job, durable, active }
  })

  return Effect.fn("Session.cancelChild")(function* (
    input: SessionSchema.CancelChildInput,
  ): Effect.fn.Return<SessionSchema.CancelChildResult, NotFoundError | ParentMismatchError> {
    const before = yield* snapshot(input)
    // The recovery claim is not an owner lease. Without a local coordinator we cannot tell
    // a dead process from a live peer sharing this database, even if a local Job has the same ID.
    if (!before.active && before.row.claim !== null)
      return {
        status: "unsupported",
        reason: "The execution is not owned by this process; no remote stop route exists",
      }
    if (!before.active && before.job?.status !== "running" && before.durable.some((job) => job.status === "running"))
      return { status: "unsupported", reason: "The durable child Job has no controllable local owner" }

    if (!before.active && before.job?.status !== "running") {
      const durable = before.durable.toSorted((a, b) => a.updated - b.updated).at(-1)
      const state = durable?.status ?? before.job?.status
      const finished = Math.max(durable?.updated ?? 0, before.job?.completed_at ?? 0)
      if (
        before.row.outcome !== null &&
        before.row.idle !== null &&
        before.row.idle >= (before.row.busy ?? 0) &&
        (state === undefined || before.row.idle > finished)
      ) {
        const idle = yield* jobs.awaitIdle(input.sessionID).pipe(Effect.timeoutOption("1 second"))
        if (idle._tag === "None") return { status: "requested" }
        if (!idle.value) return { status: "unsupported", reason: "The child Job cleanup failed" }
        switch (before.row.outcome) {
          case "succeeded":
            return { status: "terminal", state: "completed" }
          case "failed":
            return { status: "terminal", state: "error" }
          case "interrupted":
            return { status: "terminal", state: "cancelled" }
        }
      }
      if (state !== undefined && state !== "running") {
        const idle = yield* jobs.awaitIdle(input.sessionID).pipe(Effect.timeoutOption("1 second"))
        if (idle._tag === "None") return { status: "requested" }
        if (!idle.value) return { status: "unsupported", reason: "The child Job cleanup failed" }
        return { status: "terminal", state }
      }
      return { status: "unsupported", reason: "The child has no execution or Job to cancel" }
    }

    return yield* settle(
      Effect.gen(function* () {
        // Stop the coordinator first. Closing the Job scope while its execution's finalizer
        // also cancels that Job must not make either side wait on the other.
        const current = yield* snapshot(input)
        if (!current.active && current.row.claim !== null)
          return { status: "unsupported", reason: "Execution ownership changed before the stop was accepted" } as const
        yield* execution.interrupt(input.sessionID)
        yield* execution.awaitIdle(input.sessionID)
        const idle = yield* snapshot(input)
        if (!idle.active && idle.row.claim !== null)
          return {
            status: "unsupported",
            reason: "Execution ownership changed while the local stop was settling",
          } as const
        yield* jobs.cancel(input.sessionID)
        // A Job that had not entered resume at the first snapshot may have started a drain
        // before its scope closed. Closing the scope prevents another such admission.
        yield* execution.interrupt(input.sessionID)
        yield* execution.awaitIdle(input.sessionID)
        if (!(yield* jobs.awaitIdle(input.sessionID)))
          return { status: "unsupported", reason: "The child Job cleanup failed" } as const
        const after = yield* snapshot(input)
        return {
          status:
            after.active ||
            after.row.claim !== null ||
            after.job?.status === "running" ||
            after.durable.some((job) => job.status === "running")
              ? "requested"
              : "cancelled",
        } satisfies SessionSchema.CancelChildResult
      }),
    )
  })
})
