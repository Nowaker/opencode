import { Deferred, Effect } from "effect"
import { BackgroundJob } from "@/background/job"
import { ShellID } from "./id"

type Target = {
  readonly sessionID: string
  readonly messageID: string
  readonly callID: string
  readonly jobID: string
}

export const find = Effect.fn("ShellHandoff.find")(function* (target: Target) {
  const jobs = yield* BackgroundJob.Service
  const job = yield* jobs.get(target.jobID)
  if (
    job?.type !== ShellID.ToolID ||
    job.metadata?.parentSessionId !== target.sessionID ||
    job.metadata?.messageID !== target.messageID ||
    job.metadata?.callID !== target.callID
  )
    return
  return yield* jobs.foreground(job.id)
})

export function make(id: string, abort: AbortSignal) {
  const requested = Deferred.makeUnsafe<void>()
  const receipt = Deferred.makeUnsafe<string | undefined>()
  let state: "starting" | "available" | "requested" | "closed" = "starting"
  let running: Effect.Effect<boolean> = Effect.succeed(false)
  const available = () => state === "available" && !abort.aborted
  const accepted = () => state === "requested"
  return {
    available,
    open(isRunning: Effect.Effect<boolean>) {
      if (state !== "starting" || abort.aborted) return
      running = isRunning
      state = "available"
    },
    close() {
      // Once accepted, exit waits for the original tool fiber to publish the handoff.
      if (state !== "requested") state = "closed"
    },
    accepted,
    wait: Deferred.await(requested),
    move: () =>
      Effect.gen(function* () {
        if (accepted()) return yield* Deferred.await(receipt)
        if (!available() || !(yield* running)) return
        if (accepted()) return yield* Deferred.await(receipt)
        if (!available()) return
        state = "requested"
        Deferred.doneUnsafe(requested, Effect.void)
        return yield* Deferred.await(receipt)
      }),
    confirm: Deferred.succeed(receipt, id),
    decision: Deferred.await(receipt),
    refuse: Effect.sync(() => {
      state = "closed"
    }).pipe(Effect.andThen(Deferred.succeed(receipt, undefined))),
    finish: Deferred.succeed(receipt, undefined),
  }
}

export * as ShellHandoff from "./handoff"
