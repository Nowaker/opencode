export * as JobControl from "./control.js"

import type { CancelInput, CancelResult, OwnedListInput, Info, ResultInput, Result } from "@opencode/schema/job"
import { ID } from "@opencode/schema/shell"
import { desc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Cancellation } from "../cancellation.js"
import { Database } from "../database/database.js"
import { Instance } from "../instance/service.js"
import { Job } from "../job.js"
import { SessionBackground } from "../session/background.js"
import { NotFoundError } from "../session/error.js"
import { SessionStore } from "../session/store.js"
import { SessionSchema } from "../session/schema.js"
import { Shell } from "../shell.js"
import { JobTable } from "./sql.js"
import { JobList } from "./list.js"

export class MissingError extends Schema.TaggedError<MissingError>()("Job.NotFoundError", { jobID: Schema.String }) {}
export class ParentMismatchError extends Schema.TaggedError<ParentMismatchError>()("Job.ParentMismatchError", {
  parentID: SessionSchema.ID,
  jobID: Schema.String,
}) {}
export class WaitUnavailableError extends Schema.TaggedError<WaitUnavailableError>()("Job.WaitUnavailableError", {
  jobID: Schema.String,
}) {
  override get message() {
    return `The Job has no matching local execution to wait for: ${this.jobID}`
  }
}

export interface Interface {
  readonly list: (input: OwnedListInput) => Effect.Effect<{ readonly data: readonly Info[] }, NotFoundError>
  readonly cancel: (input: CancelInput) => Effect.Effect<CancelResult, MissingError | ParentMismatchError>
  readonly result: (
    input: ResultInput,
  ) => Effect.Effect<Result, MissingError | ParentMismatchError | WaitUnavailableError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/JobControl") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const jobs = yield* Job.Service
    const store = yield* SessionStore.Service
    const instances = yield* Instance.Service
    const settle = yield* Cancellation.make
    const owned = Effect.fnUntraced(function* (input: CancelInput) {
      const row = yield* db
        .select({
          id: JobTable.id,
          notification_id: JobTable.notification_id,
          session_id: JobTable.session_id,
          recovery: JobTable.recovery,
          status: JobTable.status,
          title: JobTable.title,
          time_created: JobTable.time_created,
          time_updated: JobTable.time_updated,
        })
        .from(JobTable)
        .where(eq(JobTable.id, input.jobID))
        .orderBy(desc(JobTable.time_created), desc(JobTable.notification_id))
        .get()
        .pipe(Effect.orDie)
      if (!row) return yield* new MissingError({ jobID: input.jobID })
      const owner = row.recovery.kind === "subagent" ? row.recovery.parentSessionID : row.recovery.sessionID
      if (row.session_id !== input.parentID || owner !== input.parentID) return yield* new ParentMismatchError(input)
      return row
    })
    return Service.of({
      result: Effect.fn("JobControl.result")(function* (input) {
        const row = yield* owned(input)
        const local = yield* jobs.get(input.jobID)
        if (local?.notificationID === row.notification_id) {
          const captured = input.wait ? (yield* jobs.wait({ id: input.jobID })).info : local
          if (!captured) return yield* new MissingError({ jobID: input.jobID })
          if (captured.notificationID !== row.notification_id || (input.wait && captured.status === "running"))
            return yield* new WaitUnavailableError({ jobID: input.jobID })
          return {
            ...JobList.toItem({
              id: row.id,
              status: captured.status,
              title: captured.title ?? row.title,
              started: captured.started_at,
              completed: captured.completed_at,
              recovery: row.recovery,
            }),
            ...(captured.output === undefined ? {} : { output: captured.output }),
            ...(captured.error === undefined ? {} : { error: captured.error }),
          }
        }
        const durable = yield* db
          .select({
            status: JobTable.status,
            output: JobTable.output,
            error: JobTable.error,
            updated: JobTable.time_updated,
          })
          .from(JobTable)
          .where(eq(JobTable.notification_id, row.notification_id))
          .get()
          .pipe(Effect.orDie)
        if (!durable) return yield* new MissingError({ jobID: input.jobID })
        if (input.wait && durable.status === "running")
          return yield* new WaitUnavailableError({ jobID: input.jobID })
        return {
          ...JobList.toItem({
            id: row.id,
            status: durable.status,
            title: row.title,
            started: row.time_created,
            completed: durable.status === "running" ? undefined : durable.updated,
            recovery: row.recovery,
          }),
          ...(durable.output === null ? {} : { output: durable.output }),
          ...(durable.error === null ? {} : { error: durable.error }),
        }
      }),
      list: Effect.fn("JobControl.list")(function* (input) {
        if (!(yield* store.get(input.parentSessionID)))
          return yield* new NotFoundError({ sessionID: input.parentSessionID })
        return {
          data: yield* SessionBackground.list(jobs, store, {
            sessionID: input.parentSessionID,
            descendants: input.descendants,
          }),
        }
      }),
      cancel: Effect.fn("JobControl.cancel")(function* (input) {
        const row = yield* owned(input)
        if (row.recovery.kind === "subagent")
          return { status: "unsupported", reason: "Use session.cancelChild for subagent jobs" }
        const local = yield* jobs.get(input.jobID)
        if (local?.status === "running" && local.notificationID !== row.notification_id)
          return { status: "unsupported", reason: "The local Job does not match the durable generation" }
        if (row.status !== "running" && local?.status !== "running") {
          const idle = yield* jobs.awaitIdle(input.jobID).pipe(Effect.timeoutOption("1 second"))
          if (idle._tag === "None") return { status: "requested" }
          if (!idle.value) return { status: "unsupported", reason: "The native process stop or Job cleanup failed" }
          return { status: "terminal", state: row.status }
        }
        if (!local || local.status !== "running" || local.notificationID !== row.notification_id)
          return { status: "unsupported", reason: "The durable Job has no controllable local owner" }
        const session = yield* store.get(input.parentID)
        if (!session) return { status: "unsupported", reason: "The Job's owning session no longer exists" }
        const recovery = row.recovery
        const native =
          recovery.kind === "shell"
            ? yield* Effect.gen(function* () {
                if (instances.live && !(yield* instances.live(session))) return undefined
                const id = ID.make(recovery.shellID)
                return yield* Shell.Service.use((shell) =>
                  Effect.gen(function* () {
                    yield* shell.get(id)
                    return shell.stop(id)
                  }),
                ).pipe(instances.provide(session), Effect.option)
              }).pipe(Effect.map((result) => (result?._tag === "Some" ? result.value : undefined)))
            : Effect.void
        if (native === undefined)
          return { status: "unsupported", reason: "The shell's native process owner is unavailable" }
        return yield* settle(
          Effect.gen(function* () {
            const current = yield* owned(input)
            if (current.notification_id !== row.notification_id)
              return { status: "unsupported", reason: "The Job generation changed before cancellation" } as const
            yield* jobs.cancel(input.jobID, { cleanup: native })
            if (!(yield* jobs.awaitIdle(input.jobID)))
              return { status: "unsupported", reason: "The native process stop or Job cleanup failed" } as const
            const durable = yield* db
              .select({ status: JobTable.status })
              .from(JobTable)
              .where(eq(JobTable.notification_id, row.notification_id))
              .get()
              .pipe(Effect.orDie)
            const remaining = yield* jobs.get(input.jobID)
            return {
              status: durable?.status === "running" || remaining?.status === "running" ? "requested" : "cancelled",
            } as const
          }),
        )
      }),
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Job.node, Database.node, SessionStore.node, Instance.node],
})
