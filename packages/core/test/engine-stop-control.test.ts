import { expect } from "bun:test"
import { EngineStop } from "@opencode/core/engine-stop"
import { Schedule } from "@opencode/schema/schedule"
import { Deferred, Effect, Fiber } from "effect"
import { forceInput, idleInput, it, reopen, seal } from "./fixture/engine-stop"

it.effect("invalidates an idle snapshot after a fully settled admission", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const input = yield* idleInput(service)
    yield* service.withWork(Effect.void)
    expect(yield* service.prepare(input)).toMatchObject({
      status: "refused",
      reason: { type: "activity-changed", activityRevision: input.expectedActivityRevision + 2 },
    })
    expect((yield* service.get()).state).toBe("open")
  }),
)

it.effect("preserves one exact receipt when a reconnect changes only its waiting policy", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const input = yield* idleInput(service)
    yield* service.prepare({ ...input, waitMs: 0 })
    const settled = yield* service.awaitOperation(input.operationID, 30_000)
    expect(yield* service.prepare({ ...input, waitMs: 30_000 })).toEqual(settled)
    expect((yield* service.get(input.operationID)).operation).toEqual(settled)
  }),
)

for (const change of ["mode", "revision"] as const) {
  it.effect(`conflicts on changed ${change} under a retained operation ID`, () =>
    Effect.gen(function* () {
      const service = yield* EngineStop.Service
      const input = yield* idleInput(service)
      yield* service.prepare(input)
      const changed =
        change === "mode"
          ? { ...(yield* forceInput(service)), operationID: input.operationID }
          : { ...input, expectedActivityRevision: EngineStop.ActivityRevision.make(input.expectedActivityRevision + 1) }
      expect(yield* service.prepare(changed).pipe(Effect.flip)).toMatchObject({ reason: "operation-conflict" })
      expect((yield* service.get()).operation?.operationID).toBe(input.operationID)
    }),
  )
}

it.effect("does not let wrong generations or tokens reopen the current seal", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const operation = yield* seal(service)
    const input = {
      expectedGeneration: operation.generation,
      operationID: operation.operationID,
      token: operation.token,
    }
    expect(yield* service.cancel({ ...input, token: EngineStop.Token.make("wrong") }).pipe(Effect.flip)).toMatchObject({
      reason: "token-mismatch",
    })
    expect(
      yield* service.cancel({ ...input, expectedGeneration: EngineStop.Generation.make("other") }).pipe(Effect.flip),
    ).toMatchObject({ reason: "generation-mismatch" })
    expect((yield* service.get()).state).toBe("sealed")
  }),
)

it.effect("retains cancelled and refused receipts without unsealing a newer operation", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const stale = yield* idleInput(service, "refused")
    yield* service.withWork(Effect.void)
    const refused = yield* service.prepare(stale)
    const first = yield* seal(service, "first")
    const cancelled = yield* reopen(service, first)
    const current = yield* seal(service, "current")
    expect(yield* reopen(service, first)).toEqual(cancelled)
    expect(yield* reopen(service, refused)).toEqual(refused)
    expect(yield* service.get(first.operationID)).toMatchObject({
      state: "sealed",
      operation: { status: "cancelled", operationID: first.operationID },
    })
    expect((yield* service.get()).operation).toEqual(current)
  }),
)

it.effect("rejects conflicting operation IDs and reports unknown waits as control errors", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    yield* seal(service)
    expect(yield* service.prepare(yield* forceInput(service, "other")).pipe(Effect.flip)).toMatchObject({
      reason: "operation-active",
    })
    expect(
      yield* service.awaitOperation(EngineStop.OperationID.make("unknown"), 30_000).pipe(Effect.flip),
    ).toMatchObject({ reason: "operation-not-found" })
    expect((yield* service.get(EngineStop.OperationID.make("unknown"))).operation).toBeNull()
  }),
)

it.effect("uses scoped scheduler probes to veto only their reported active IDs", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const id = Schedule.ID.make("sch_owned")
    const refused = yield* Effect.scoped(
      Effect.gen(function* () {
        yield* service.registerSchedulerProbe(Effect.succeed([id]))
        return yield* seal(service, "leader")
      }),
    )
    expect(refused).toMatchObject({
      status: "refused",
      reason: { type: "native-schedule-armed", scheduleIDs: [id] },
    })
    expect(yield* seal(service, "released-probe")).toMatchObject({ status: "sealed" })
  }),
)

it.effect("installs the admission barrier before awaiting a scheduler probe", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const entered = yield* Deferred.make<void>()
    const finish = yield* Deferred.make<readonly Schedule.ID[]>()
    yield* service.registerSchedulerProbe(
      Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(finish))),
    )
    const input = yield* idleInput(service)
    const operation = yield* service.prepare(input)
    yield* Deferred.await(entered)
    expect(yield* service.withWork(Effect.void).pipe(Effect.flip)).toMatchObject({ operationState: "preparing" })
    yield* reopen(service, operation)
    yield* Deferred.succeed(finish, [])
    const waiter = yield* service.awaitOperation(input.operationID, 30_000).pipe(Effect.forkChild)
    expect(yield* Fiber.join(waiter)).toMatchObject({ status: "cancelled" })
    expect((yield* service.get()).state).toBe("open")
  }),
)
