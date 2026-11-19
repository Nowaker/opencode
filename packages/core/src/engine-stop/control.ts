import { EngineStop } from "@opencode/schema/engine-stop"
import type { Schedule } from "@opencode/schema/schedule"
import { Deferred, Effect, Exit, Scope } from "effect"
import { absurd } from "effect/Function"
import { randomUUID } from "node:crypto"
import type { make } from "./claims.js"
import { State, type Receipt } from "./state.js"

type Claims = ReturnType<typeof make>

export const control = (state: State, claims: Claims) =>
  Effect.gen(function* () {
    const scope = yield* Scope.Scope
    const error = (reason: EngineStop.ControlError["reason"], operationID: EngineStop.OperationID) =>
      new EngineStop.ControlError({ reason, generation: state.generation, operationID, message: reason })
    const finish = (receipt: Receipt, operation: EngineStop.Operation) => {
      if (state.barrier !== receipt) return
      if (operation.status !== "sealed") state.barrier = undefined
      state.finish(receipt, operation)
    }

    const force = (receipt: Receipt): Effect.Effect<void> =>
      Effect.suspend(() => {
        if (state.barrier !== receipt) return Effect.void
        if (state.owners.size === 0) {
          finish(receipt, { ...receipt.operation, status: "sealed" })
          return Effect.void
        }
        const changed = state.changed
        const targets = Array.from(state.owners.values()).flatMap((owner) => {
          if (!owner.cancel || receipt.sent.has(owner)) return []
          receipt.sent.add(owner)
          return [{ owner, cancel: owner.cancel }]
        })
        return Effect.forEach(
          targets,
          (target) =>
            Effect.suspend(() =>
              state.barrier === receipt && state.owners.get(target.owner.key) === target.owner
                ? target.cancel
                : Effect.void,
            ).pipe(Effect.forkIn(scope)),
          { discard: true },
        ).pipe(Effect.andThen(Deferred.await(changed)), Effect.andThen(force(receipt)))
      })

    const idle = (receipt: Receipt) =>
      Effect.gen(function* () {
        const scheduleIDs = Array.from(new Set((yield* Effect.all(Array.from(state.probes.values()))).flat()))
        if (state.barrier !== receipt) return
        if (scheduleIDs.length > 0) {
          finish(receipt, {
            ...receipt.operation,
            mode: "idle",
            status: "refused",
            reason: { type: "native-schedule-armed", scheduleIDs },
          })
          return
        }
        finish(receipt, { ...receipt.operation, status: "sealed" })
      })

    const worker = (receipt: Receipt) => {
      const work = Effect.suspend(() => {
        const mode = receipt.input.mode
        switch (mode) {
          case "idle":
            return idle(receipt)
          case "force-restart":
            return force(receipt)
          default:
            return absurd<never>(mode)
        }
      })
      return claims.unclaimed(
        work.pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              if (Exit.isFailure(exit)) finish(receipt, { ...receipt.operation, status: "cancelled" })
            }),
          ),
          Effect.forkIn(scope),
        ),
      )
    }

    const prepare = (input: EngineStop.PrepareInput) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          // This entire decision runs without a yield between comparison and barrier installation.
          const decision = yield* Effect.suspend(() => {
            if (input.expectedGeneration !== state.generation)
              return Effect.fail(error("generation-mismatch", input.operationID))
            const existing = state.receipts.get(input.operationID)
            if (existing) {
              if (
                existing.input.mode !== input.mode ||
                existing.input.expectedActivityRevision !== input.expectedActivityRevision
              )
                return Effect.fail(error("operation-conflict", input.operationID))
              return Effect.succeed({ receipt: existing, start: false })
            }
            if (state.barrier) return Effect.fail(error("operation-active", input.operationID))
            // waitMs belongs to the request, never to the operation's retained identity.
            const { waitMs: _, ...identity } = input
            const receipt: Receipt = {
              input: identity,
              operation: {
                generation: state.generation,
                operationID: input.operationID,
                mode: input.mode,
                token: EngineStop.Token.make(randomUUID()),
                status: "preparing",
              },
              settled: Deferred.makeUnsafe<EngineStop.Operation>(),
              sent: new Set(),
            }
            state.receipts.set(input.operationID, receipt)
            switch (input.mode) {
              case "idle": {
                const reason: EngineStop.Refused["reason"] | undefined =
                  state.revision !== input.expectedActivityRevision
                    ? { type: "activity-changed", activityRevision: state.revision }
                    : state.owners.size > 0
                      ? { type: "work-active", activeClaims: state.owners.size }
                      : undefined
                if (reason) {
                  state.finish(receipt, { ...receipt.operation, mode: "idle", status: "refused", reason })
                  return Effect.succeed({ receipt, start: false })
                }
                break
              }
              case "force-restart":
                break
              default:
                return absurd<never>(input)
            }
            state.barrier = receipt
            if (input.mode === "force-restart") {
              for (const owner of state.owners.values()) owner.shutdown.requested = true
            }
            state.signal()
            return Effect.succeed({ receipt, start: true })
          })
          const operation = decision.receipt.operation
          if (decision.start) yield* worker(decision.receipt)
          return operation
        }),
      )

    const cancel = (input: EngineStop.CancelInput) =>
      Effect.suspend(() => {
        if (input.expectedGeneration !== state.generation)
          return Effect.fail(error("generation-mismatch", input.operationID))
        const receipt = state.receipts.get(input.operationID)
        if (!receipt) return Effect.fail(error("operation-not-found", input.operationID))
        if (receipt.operation.token !== input.token) return Effect.fail(error("token-mismatch", input.operationID))
        if (state.barrier === receipt) finish(receipt, { ...receipt.operation, status: "cancelled" })
        return Effect.succeed(receipt.operation)
      })

    const awaitOperation = (operationID: EngineStop.OperationID, waitMs: EngineStop.WaitMillis = 0) =>
      Effect.suspend(() => {
        const receipt = state.receipts.get(operationID)
        if (!receipt) return Effect.fail(error("operation-not-found", operationID))
        if (receipt.operation.status !== "preparing" || waitMs === 0) return Effect.succeed(receipt.operation)
        return Deferred.await(receipt.settled).pipe(
          Effect.timeoutOption(waitMs),
          Effect.andThen(Effect.sync(() => receipt.operation)),
        )
      })

    const registerSchedulerProbe = <R>(probe: Effect.Effect<readonly Schedule.ID[], never, R>) =>
      Effect.gen(function* () {
        const context = yield* Effect.context<R>()
        const key = Symbol()
        yield* claims.withWork(
          Effect.acquireRelease(
            Effect.sync(() => state.probes.set(key, Effect.setContext(probe, context))),
            () => Effect.sync(() => state.probes.delete(key)),
          ),
        )
      })

    const awaitOpen: Effect.Effect<void> = Effect.suspend(() => {
      if (!state.barrier) return Effect.void
      return Deferred.await(state.changed).pipe(Effect.andThen(awaitOpen))
    })

    return {
      get: (operationID?: EngineStop.OperationID) => Effect.sync(() => state.info(operationID)),
      prepare,
      cancel,
      awaitOperation,
      registerSchedulerProbe,
      awaitOpen,
    }
  })
