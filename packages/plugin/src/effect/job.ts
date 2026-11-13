import type { ExperimentalApi } from "@opencode/client/effect/api"
import type { Job } from "@opencode/schema/job"
import type { Effect } from "effect"

export interface JobDomain {
  readonly list: (input: Job.OwnedListInput) => Effect.Effect<{ readonly data: readonly Job.Info[] }, unknown>
  readonly cancel: ExperimentalApi<unknown>["job"]["cancel"]
  /** Reads an owned native outcome; interrupting wait stops only the reader. */
  readonly result: (input: Job.ResultInput) => Effect.Effect<Job.Result, unknown>
}
