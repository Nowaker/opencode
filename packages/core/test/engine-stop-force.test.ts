import { expect } from "bun:test"
import { EngineStop } from "@opencode/core/engine-stop"
import { Deferred, Effect, Fiber, Scope } from "effect"
import { TestClock } from "effect/testing"
import { forceInput, it, reopen, seal } from "./fixture/engine-stop"

it.effect("dispatches every owned interruption before waiting for uninterruptible terminal cleanup", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const release = yield* Deferred.make<void>()
    const cleaning = yield* Effect.all([Deferred.make<void>(), Deferred.make<void>()])
    const fibers = yield* Effect.forEach(cleaning, (signal) =>
      service
        .withWork(
          Effect.never.pipe(
            Effect.ensuring(Deferred.succeed(signal, undefined).pipe(Effect.andThen(Deferred.await(release)))),
          ),
        )
        .pipe(Effect.forkScoped({ startImmediately: true })),
    )
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
    const input = yield* forceInput(service)
    const operation = yield* service.prepare(input)
    expect(operation.status).toBe("preparing")
    yield* Effect.all(cleaning.map(Deferred.await))
    expect(yield* service.get()).toMatchObject({ state: "preparing", activeClaims: 2 })
    expect(yield* service.withWork(Effect.void).pipe(Effect.flip)).toMatchObject({ operationState: "preparing" })
    yield* Deferred.succeed(release, undefined)
    expect(yield* service.awaitOperation(input.operationID, 30_000)).toMatchObject({ status: "sealed" })
    yield* Effect.all(fibers.map(Fiber.await))
  }),
)

it.effect("returns force preparation immediately even when the caller owns the claim being stopped", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const cancelled = yield* Deferred.make<void>()
    const operation = yield* service.withWork(
      forceInput(service).pipe(Effect.flatMap(service.prepare)),
      Deferred.succeed(cancelled, undefined).pipe(Effect.asVoid),
    )
    expect(operation.status).toBe("preparing")
    expect(yield* service.awaitOperation(operation.operationID, 30_000)).toMatchObject({ status: "sealed" })
  }),
)

it.effect("retains owed transfer under preparation and cancels its bound successor without a gap", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const cancelled = yield* Deferred.make<void>()
    const predecessorCancelled = yield* Deferred.make<void>()
    const done = yield* Deferred.make<void>()
    const scope = yield* Scope.Scope
    const result = yield* service.withWork(
      Effect.gen(function* () {
        const operation = yield* service.prepare(yield* forceInput(service))
        const reservation = yield* service.transfer()
        const successor = yield* reservation.fork(
          service.within(Deferred.await(done)),
          scope,
          Deferred.succeed(cancelled, undefined).pipe(Effect.asVoid),
        )
        return { operation, successor }
      }),
      Deferred.succeed(predecessorCancelled, undefined).pipe(Effect.asVoid),
    )
    yield* Deferred.await(cancelled)
    expect(yield* service.get()).toMatchObject({ state: "preparing", activeClaims: 1 })
    yield* Deferred.succeed(done, undefined)
    yield* Fiber.join(result.successor)
    expect(yield* service.awaitOperation(result.operation.operationID, 30_000)).toMatchObject({ status: "sealed" })
  }),
)

it.effect("observes forced shutdown at successor binding before asynchronous cancellation dispatch", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const result = yield* service.withWork(
      Effect.gen(function* () {
        const operation = yield* service.prepare(yield* forceInput(service))
        const reservation = yield* service.transfer()
        const requested = yield* reservation.run(service.shutdownRequested, Effect.void)
        return { operation, requested }
      }),
      Effect.void,
    )
    expect(result.requested).toBe(true)
    expect(yield* service.awaitOperation(result.operation.operationID, 30_000)).toMatchObject({ status: "sealed" })
  }),
)

it.effect("preserves requested shutdown after reopening while fresh ownership starts without it", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const observed = yield* service.withWork(
      Effect.gen(function* () {
        const operation = yield* service.prepare(yield* forceInput(service))
        const requested = yield* service.shutdownRequested
        yield* reopen(service, operation)
        const afterCancel = yield* service.shutdownRequested
        const fresh = yield* service.withWork(service.shutdownRequested)
        const reservation = yield* service.transfer()
        const transferred = yield* reservation.run(service.shutdownRequested, Effect.void)
        return [requested, afterCancel, fresh, transferred]
      }),
      Effect.void,
    )
    expect(observed).toEqual([true, true, false, true])
  }),
)

it.effect("does not reseal or target newer owners after cancellation even when old cancellation was sent", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const sent = yield* Deferred.make<void>()
    const oldDone = yield* Deferred.make<void>()
    const newDone = yield* Deferred.make<void>()
    const cancellations: string[] = []
    const old = yield* service
      .withWork(
        Deferred.await(oldDone),
        Effect.sync(() => cancellations.push("old")).pipe(
          Effect.andThen(Deferred.succeed(sent, undefined)),
          Effect.asVoid,
        ),
      )
      .pipe(Effect.forkScoped({ startImmediately: true }))
    const input = yield* forceInput(service)
    const operation = yield* service.prepare(input)
    yield* Deferred.await(sent)
    expect(yield* service.prepare(input)).toEqual(operation)
    yield* reopen(service, operation)
    const current = yield* service
      .withWork(
        Deferred.await(newDone),
        Effect.sync(() => {
          cancellations.push("new")
        }),
      )
      .pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Deferred.succeed(oldDone, undefined)
    yield* Fiber.join(old)
    expect(yield* service.get()).toMatchObject({ state: "open", activeClaims: 1 })
    expect(cancellations).toEqual(["old"])
    yield* Deferred.succeed(newDone, undefined)
    yield* Fiber.join(current)
    const next = yield* seal(service, "next")
    yield* reopen(service, operation)
    expect((yield* service.get()).operation).toEqual(next)
  }),
)

it.effect("bounds an operation waiter with one request timeout while leaving preparation owned", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const sent = yield* Deferred.make<void>()
    const done = yield* Deferred.make<void>()
    const owner = yield* service
      .withWork(Deferred.await(done), Deferred.succeed(sent, undefined).pipe(Effect.asVoid))
      .pipe(Effect.forkScoped({ startImmediately: true }))
    const operation = yield* service.prepare(yield* forceInput(service))
    yield* Deferred.await(sent)
    const waiter = yield* service
      .awaitOperation(operation.operationID, 100)
      .pipe(Effect.forkChild({ startImmediately: true }))
    yield* TestClock.adjust(100)
    expect(yield* Fiber.join(waiter)).toEqual(operation)
    expect((yield* service.get()).state).toBe("preparing")
    yield* Deferred.succeed(done, undefined)
    yield* Fiber.join(owner)
    expect(yield* service.awaitOperation(operation.operationID, 30_000)).toMatchObject({ status: "sealed" })
  }),
)

it.effect("interrupts only a disconnected waiter while other waiters observe the same settlement signal", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const done = yield* Deferred.make<void>()
    const sent = yield* Deferred.make<void>()
    const owner = yield* service
      .withWork(Deferred.await(done), Deferred.succeed(sent, undefined).pipe(Effect.asVoid))
      .pipe(Effect.forkScoped({ startImmediately: true }))
    const operation = yield* service.prepare(yield* forceInput(service))
    yield* Deferred.await(sent)
    const abandoned = yield* service
      .awaitOperation(operation.operationID, 30_000)
      .pipe(Effect.forkChild({ startImmediately: true }))
    const remaining = yield* service
      .awaitOperation(operation.operationID, 30_000)
      .pipe(Effect.forkChild({ startImmediately: true }))
    yield* Fiber.interrupt(abandoned)
    yield* Deferred.succeed(done, undefined)
    yield* Fiber.join(owner)
    expect(yield* Fiber.join(remaining)).toMatchObject({ status: "sealed", token: operation.token })
  }),
)

it.effect("retains an already owed reservation while force preparation refuses fresh reservations", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const sent = yield* Deferred.make<void>()
    const result = yield* service.withWork(
      Effect.gen(function* () {
        const operation = yield* service.prepare(yield* forceInput(service))
        const reservation = yield* service.retain()
        expect(yield* service.reserve().pipe(Effect.flip)).toMatchObject({ _tag: "EngineStop.RefusedError" })
        return { operation, reservation }
      }),
      Deferred.succeed(sent, undefined).pipe(Effect.asVoid),
    )
    expect(yield* service.get()).toMatchObject({ state: "preparing", activeClaims: 1 })
    yield* result.reservation.release
    expect(yield* service.awaitOperation(result.operation.operationID, 30_000)).toMatchObject({ status: "sealed" })
  }),
)
