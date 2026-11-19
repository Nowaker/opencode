import { EngineStop } from "@opencode/core/engine-stop"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"

export const it = testEffect(EngineStop.layer)

export const idleInput = (service: EngineStop.Interface, name = "stop") =>
  service.get().pipe(
    Effect.map((info) => ({
      expectedGeneration: info.generation,
      expectedActivityRevision: info.activityRevision,
      operationID: EngineStop.OperationID.make(name),
      mode: "idle" as const,
    })),
  )

export const forceInput = (service: EngineStop.Interface, name = "restart") =>
  service.get().pipe(
    Effect.map((info) => ({
      expectedGeneration: info.generation,
      operationID: EngineStop.OperationID.make(name),
      mode: "force-restart" as const,
    })),
  )

export const seal = (service: EngineStop.Interface, name = "stop") =>
  Effect.gen(function* () {
    const input = yield* idleInput(service, name)
    yield* service.prepare(input)
    return yield* service.awaitOperation(input.operationID, 10_000)
  })

export const reopen = (service: EngineStop.Interface, operation: EngineStop.Operation) =>
  service.cancel({
    expectedGeneration: operation.generation,
    operationID: operation.operationID,
    token: operation.token,
  })
