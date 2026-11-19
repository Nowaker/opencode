import { EngineStop } from "@opencode/core/engine-stop"
import { Effect } from "effect"

/** `server.stop.*` in the `server.experimental` group. */
export const makeServerStop = Effect.gen(function* () {
  const stop = yield* EngineStop.Service

  return {
    get: Effect.fn("ServerStopHandler.get")(function* (query: EngineStop.GetQuery) {
      const info = yield* stop.get(query.operationID)
      if (info.operation?.status === "preparing" && (query.waitMs ?? 0) > 0) {
        yield* stop.awaitOperation(info.operation.operationID, query.waitMs)
        return yield* stop.get(query.operationID)
      }
      return info
    }),
    prepare: Effect.fn("ServerStopHandler.prepare")(function* (input: EngineStop.PrepareInput) {
      const operation = yield* stop.prepare(input)
      return yield* stop.awaitOperation(operation.operationID, input.waitMs)
    }),
    cancel: (input: EngineStop.CancelInput) => stop.cancel(input),
  }
})
