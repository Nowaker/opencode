import { EngineStop } from "@opencode/schema/engine-stop"
import type { Schedule } from "@opencode/schema/schedule"
import { Deferred, Effect, type Fiber } from "effect"
import { absurd } from "effect/Function"
import { randomUUID } from "node:crypto"

export type Owner = {
  readonly key: symbol
  /** Shared by owed successors; reopening never clears a requested shutdown. */
  readonly shutdown: { requested: boolean }
  readonly fiber?: Fiber.Fiber<unknown, unknown>
  readonly cancel?: Effect.Effect<void>
}

export type Receipt = {
  readonly input: EngineStop.PrepareInput
  readonly settled: Deferred.Deferred<EngineStop.Operation>
  readonly sent: Set<Owner>
  operation: EngineStop.Operation
}

/** All mutations are synchronous; no database transaction or lock spans a wait. */
export class State {
  readonly generation = EngineStop.Generation.make(randomUUID())
  readonly owners = new Map<symbol, Owner>()
  readonly receipts = new Map<EngineStop.OperationID, Receipt>()
  readonly probes = new Map<symbol, Effect.Effect<readonly Schedule.ID[]>>()
  revision = EngineStop.ActivityRevision.make(0)
  changed = Deferred.makeUnsafe<void>()
  barrier: Receipt | undefined

  signal() {
    const previous = this.changed
    this.changed = Deferred.makeUnsafe<void>()
    Deferred.doneUnsafe(previous, Effect.void)
  }

  enter(owner: Owner) {
    if (this.barrier?.input.mode === "force-restart") owner.shutdown.requested = true
    this.owners.set(owner.key, owner)
    this.revision = EngineStop.ActivityRevision.make(this.revision + 1)
    this.signal()
  }

  release(owner: Owner) {
    // A predecessor's finalizer cannot release a transferred successor.
    if (this.owners.get(owner.key) !== owner) return
    this.owners.delete(owner.key)
    this.revision = EngineStop.ActivityRevision.make(this.revision + 1)
    this.signal()
  }

  finish(receipt: Receipt, operation: EngineStop.Operation) {
    receipt.operation = operation
    receipt.sent.clear()
    Deferred.doneUnsafe(receipt.settled, Effect.succeed(operation))
    this.signal()
  }

  refusal(admission: EngineStop.RefusedError["admission"] = { status: "not-admitted" }) {
    const operation = this.barrier?.operation
    if (!operation) return
    switch (operation.status) {
      case "preparing":
      case "sealed":
        return new EngineStop.RefusedError({
          generation: this.generation,
          operationID: operation.operationID,
          mode: operation.mode,
          operationState: operation.status,
          retryable: true,
          admission,
          message: "This engine is closed to fresh work; this attempt made no new admission.",
        })
      case "cancelled":
      case "refused":
        return
      default:
        return absurd<never>(operation)
    }
  }

  info(operationID?: EngineStop.OperationID): EngineStop.Info {
    const operation = this.barrier?.operation
    return {
      generation: this.generation,
      activityRevision: this.revision,
      state: operation?.status === "sealed" ? "sealed" : this.barrier ? "preparing" : "open",
      activeClaims: this.owners.size,
      operation: operationID === undefined ? (operation ?? null) : (this.receipts.get(operationID)?.operation ?? null),
    }
  }
}
