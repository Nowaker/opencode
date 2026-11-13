import { Job } from "@opencode/core/job"
import { JobControl } from "@opencode/core/job/control"
import { ConflictError, JobNotFoundError } from "@opencode/protocol/errors"
import { Session } from "@opencode/core/session"
import { SessionBackground } from "@opencode/core/session/background"
import type { ListQuery } from "@opencode/protocol/groups/job"
import { Effect, Option } from "effect"
import { missingSession } from "./session-error"

/** `job.*` in the `server.experimental` group. */
export const makeJob = Effect.gen(function* () {
  const jobs = yield* Job.Service
  const control = yield* JobControl.Service
  const sessions = yield* Session.Service
  const lookup = {
    get: (sessionID: Session.ID) => sessions.get(sessionID).pipe(Effect.option, Effect.map(Option.getOrUndefined)),
  }

  return {
    cancel: (input: Parameters<JobControl.Interface["cancel"]>[0]) =>
      control.cancel(input).pipe(
        Effect.catchTag(
          "Job.NotFoundError",
          (error) => new JobNotFoundError({ jobID: error.jobID, message: `Job not found: ${error.jobID}` }),
        ),
        Effect.catchTag(
          "Job.ParentMismatchError",
          (error) =>
            new ConflictError({ resource: error.jobID, message: "The Job is not owned by the requested parent" }),
        ),
      ),
    list: Effect.fn("JobHandler.list")(function* (query: ListQuery) {
      if (query.sessionID !== undefined) {
        yield* sessions.get(query.sessionID).pipe(Effect.catchTag("Session.NotFoundError", missingSession))
      }
      return {
        data: yield* SessionBackground.list(jobs, lookup, query),
      }
    }),
  }
})
