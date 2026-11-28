import { Effect, Fiber, Schema } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { constants } from "node:os"
import type { BackgroundJob } from "@/background/job"

export class ForegroundShellError extends Schema.TaggedErrorClass<ForegroundShellError>()("ForegroundShellError", {
  reason: Schema.Literals(["startup-failed", "missing-spawn", "missing-exit"]),
  message: Schema.String,
}) {}

export function spawnFailureDetail({ reason }: PlatformError) {
  const cause = reason.cause
  const code =
    cause instanceof Error &&
    "code" in cause &&
    typeof cause.code === "string" &&
    Object.hasOwn(constants.errno, cause.code)
      ? cause.code
      : undefined
  const detail = reason._tag === "PermissionDenied" ? "permission denied" : reason._tag
  return code ? `${detail} (${code})` : detail
}

export const cancelUnsettledForeground = Effect.fnUntraced(
  function* (background: BackgroundJob.Interface, id: string, releaseJob: () => void) {
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        releaseJob()
        // The registry fences the job and publishes its receipt before joining the
        // native scope. A lost spawn or close callback can also stall that join.
        const cleanup = yield* background.cancel(id).pipe(Effect.forkDetach({ startImmediately: true }))
        const receipt = background.wait({ id })
        return (yield* restore(Effect.raceFirst(receipt, Fiber.join(cleanup).pipe(Effect.andThen(receipt))))).info
      }),
    )
  },
)
