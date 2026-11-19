import { expect } from "bun:test"
import { EngineStop } from "@opencode/core/engine-stop"
import { SessionMessage } from "@opencode/schema/session-message"
import { Context, Deferred, Effect, Exit, Fiber, Scope } from "effect"
import { idleInput, it, reopen, seal } from "./fixture/engine-stop"

it.effect("advances activity on entry and settlement even when no work remains", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const before = yield* service.get()
    const during = yield* service.withWork(service.get())
    const after = yield* service.get()
    expect([during.activeClaims, during.activityRevision]).toEqual([1, before.activityRevision + 1])
    expect([after.activeClaims, after.activityRevision]).toEqual([0, before.activityRevision + 2])
  }),
)

it.effect("borrows a live claim only in its owning fiber", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const result = yield* service.withWork(
      Effect.gen(function* () {
        const borrowed = yield* service.within(service.get())
        const child = yield* service.within(service.get()).pipe(Effect.forkChild({ startImmediately: true }))
        return { borrowed, child: yield* Fiber.join(child) }
      }),
    )
    expect(result.borrowed.activeClaims).toBe(1)
    expect(result.child.activeClaims).toBe(2)
  }),
)

it.effect("rejects an inherited claim after its original fiber releases and the engine seals", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const proceed = yield* Deferred.make<void>()
    const scope = yield* Scope.Scope
    const child = yield* service.withWork(
      Deferred.await(proceed).pipe(
        Effect.andThen(service.within(Effect.succeed("admitted"))),
        Effect.exit,
        Effect.forkIn(scope, { startImmediately: true }),
      ),
    )
    yield* seal(service)
    yield* Deferred.succeed(proceed, undefined)
    expect(Exit.isFailure(yield* Fiber.join(child))).toBe(true)
    expect((yield* service.get()).activeClaims).toBe(0)
  }),
)

it.effect("distinguishes reconciled existing input from fresh refusal without exposing a receipt token", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const operation = yield* seal(service)
    const inputID = SessionMessage.ID.create()
    const existing = yield* service.check({ status: "existing", inputID }).pipe(Effect.flip)
    const fresh = yield* service.withWork(Effect.void).pipe(Effect.flip)
    expect(existing).toMatchObject({
      _tag: "EngineStop.RefusedError",
      operationID: operation.operationID,
      admission: { status: "existing", inputID },
    })
    expect(fresh.admission).toEqual({ status: "not-admitted" })
    expect(existing).not.toHaveProperty("token")
  }),
)

it.effect("keeps a scoped reservation owned until binding or registration unwind", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const refusal = yield* Effect.scoped(
      Effect.gen(function* () {
        yield* service.reserve()
        return yield* service.prepare(yield* idleInput(service))
      }),
    )
    expect(refusal).toMatchObject({ status: "refused", reason: { type: "work-active", activeClaims: 1 } })
    expect((yield* service.get()).activeClaims).toBe(0)
  }),
)

it.effect("transfers ownership without a zero-count gap or release by the predecessor", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const reservation = yield* service.withWork(service.transfer())
    const input = yield* idleInput(service)
    expect(yield* service.prepare(input)).toMatchObject({
      status: "refused",
      reason: { type: "work-active", activeClaims: 1 },
    })
    const bound = yield* reservation.run(service.within(service.get())).pipe(Effect.setContext(Context.empty()))
    expect(bound.activeClaims).toBe(1)
    expect((yield* service.get()).activeClaims).toBe(0)
    expect(yield* reservation.run(Effect.void).pipe(Effect.flip)).toMatchObject({
      _tag: "EngineStop.OwnershipError",
      reason: "expired-reservation",
    })
  }),
)

it.effect("retains detached ownership after its submitting scope releases", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const scope = yield* Scope.Scope
    const done = yield* Deferred.make<void>()
    const child = yield* Effect.scoped(
      Effect.gen(function* () {
        const reservation = yield* service.reserve()
        return yield* reservation.fork(Deferred.await(done), scope)
      }),
    )
    expect((yield* service.get()).activeClaims).toBe(1)
    yield* Deferred.succeed(done, undefined)
    yield* Fiber.join(child)
    expect((yield* service.get()).activeClaims).toBe(0)
  }),
)

it.effect("unwinds a detached reservation when the destination scope is already closed", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const scope = yield* Scope.make()
    yield* Scope.close(scope, Exit.void)
    const reservation = yield* service.reserve()
    const started: string[] = []
    const child = yield* reservation.fork(
      Effect.sync(() => {
        started.push("work")
      }).pipe(Effect.andThen(Effect.never)),
      scope,
    )
    yield* Fiber.await(child)
    expect(started).toEqual([])
    expect((yield* service.get()).activeClaims).toBe(0)
  }),
)

it.effect("refuses fresh claims before evaluating their work and admits normally after cancellation", () =>
  Effect.gen(function* () {
    const service = yield* EngineStop.Service
    const effects: string[] = []
    const operation = yield* seal(service)
    yield* service.withWork(Effect.sync(() => effects.push("sealed"))).pipe(Effect.flip)
    yield* reopen(service, operation)
    yield* service.withWork(Effect.sync(() => effects.push("open")))
    expect(effects).toEqual(["open"])
  }),
)
