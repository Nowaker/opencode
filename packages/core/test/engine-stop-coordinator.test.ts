import { expect } from "bun:test"
import { EngineStop } from "@opencode/core/engine-stop"
import { SessionRunCoordinator } from "@opencode/core/session/run-coordinator"
import { Cause, Deferred, Effect, Exit, Fiber } from "effect"
import { forceInput, idleInput, it, seal } from "./fixture/engine-stop"

type Reason = "user" | "shutdown"

// A coordinator wired to the real gate, recording its lifecycle hooks.
const harness = (options: {
  readonly started?: Effect.Effect<void>
  readonly drain?: Effect.Effect<void>
  readonly settled?: (coordinator: SessionRunCoordinator.Coordinator<string, never, Reason>) => Effect.Effect<void>
}) =>
  Effect.gen(function* () {
    const claims = yield* EngineStop.Service
    const events = { started: 0, drains: 0, settled: [] as (Reason | "succeeded" | "failed")[] }
    const entered = yield* Deferred.make<void>()
    const drainEntered = yield* Deferred.make<void>()
    const firstSettled = yield* Deferred.make<void>()
    const coordinator: SessionRunCoordinator.Coordinator<string, never, Reason> = yield* SessionRunCoordinator.make<
      string,
      never,
      Reason
    >({
      claims,
      shutdownReason: "shutdown",
      started: () =>
        Effect.sync(() => events.started++).pipe(
          Effect.andThen(Deferred.succeed(entered, undefined)),
          Effect.andThen(options.started ?? Effect.void),
        ),
      drain: () =>
        Effect.sync(() => events.drains++).pipe(
          Effect.andThen(Deferred.succeed(drainEntered, undefined)),
          Effect.andThen(options.drain ?? Effect.void),
        ),
      settled: (_key, exit, reason) =>
        Effect.sync(() =>
          events.settled.push(
            Exit.isSuccess(exit) ? "succeeded" : Cause.hasInterrupts(exit.cause) ? (reason ?? "shutdown") : "failed",
          ),
        ).pipe(
          Effect.andThen(Deferred.succeed(firstSettled, undefined)),
          Effect.andThen(options.settled?.(coordinator) ?? Effect.void),
        ),
    })
    // An execution that settles before its first drain would leave a bare drain wait hanging; fail by name instead.
    const drained = Effect.raceFirst(
      Deferred.await(drainEntered),
      Deferred.await(firstSettled).pipe(
        Effect.andThen(
          Effect.suspend(() =>
            Effect.die(new Error(`the execution settled before its first drain: ${JSON.stringify(events)}`)),
          ),
        ),
      ),
    )
    return { claims, coordinator, events, entered, drained }
  })

it.effect("holds a claim for the whole busy period, so idle preparation refuses while it runs", () =>
  Effect.gen(function* () {
    const release = yield* Deferred.make<void>()
    const h = yield* harness({ drain: Deferred.await(release) })
    yield* h.coordinator.wake("ses")
    yield* h.drained
    const refused = yield* h.claims.prepare(yield* idleInput(h.claims, "busy"))
    expect(refused).toMatchObject({ status: "refused", reason: { type: "work-active" } })
    yield* Deferred.succeed(release, undefined)
    yield* h.coordinator.awaitIdle("ses")
    expect(yield* h.claims.get()).toMatchObject({ state: "open", activeClaims: 0 })
    expect(yield* seal(h.claims, "idle")).toMatchObject({ status: "sealed" })
  }),
)

it.effect("interrupts a draining execution with the shutdown reason and seals once it settles", () =>
  Effect.gen(function* () {
    const h = yield* harness({ drain: Effect.never })
    yield* h.coordinator.wake("ses")
    yield* h.drained
    // Waiters resume synchronously on the execution's settlement, so this reads the claims at that moment.
    const atIdle = yield* h.coordinator.awaitIdle("ses").pipe(Effect.andThen(h.claims.get()), Effect.forkChild)
    const input = yield* forceInput(h.claims)
    expect((yield* h.claims.prepare(input)).status).toBe("preparing")
    expect(yield* h.claims.awaitOperation(input.operationID, 10_000)).toMatchObject({ status: "sealed" })
    expect(h.events).toMatchObject({ started: 1, drains: 1, settled: ["shutdown"] })
    expect(yield* Fiber.join(atIdle)).toMatchObject({ activeClaims: 0 })
  }),
)

it.effect("stops an execution asked to shut down during bootstrap after Started and before any drain", () =>
  Effect.gen(function* () {
    const gate = yield* Deferred.make<void>()
    const h = yield* harness({ started: Deferred.await(gate) })
    yield* h.coordinator.wake("ses")
    yield* Deferred.await(h.entered)
    const input = yield* forceInput(h.claims)
    expect((yield* h.claims.prepare(input)).status).toBe("preparing")
    yield* Deferred.succeed(gate, undefined)
    expect(yield* h.claims.awaitOperation(input.operationID, 10_000)).toMatchObject({ status: "sealed" })
    expect(h.events).toMatchObject({ started: 1, drains: 0, settled: ["shutdown"] })
  }),
)

it.effect("hands a successor owed during forced settlement its claim and shutdown, with no drain", () =>
  Effect.gen(function* () {
    let rung = false
    const h = yield* harness({
      drain: Effect.never,
      // A doorbell rung during interruption cleanup is new work owed at settlement.
      settled: (coordinator) =>
        rung ? Effect.void : Effect.sync(() => (rung = true)).pipe(Effect.andThen(coordinator.wake("ses"))),
    })
    yield* h.coordinator.wake("ses")
    yield* h.drained
    const input = yield* forceInput(h.claims)
    yield* h.claims.prepare(input)
    expect(yield* h.claims.awaitOperation(input.operationID, 10_000)).toMatchObject({ status: "sealed" })
    expect(h.events).toMatchObject({ started: 2, drains: 1, settled: ["shutdown", "shutdown"] })
    expect(yield* h.claims.get()).toMatchObject({ state: "sealed", activeClaims: 0 })
  }),
)

it.effect("starts nothing for a wake or run while sealed, leaving the work owed", () =>
  Effect.gen(function* () {
    const h = yield* harness({})
    yield* seal(h.claims, "sealed")
    yield* h.coordinator.wake("ses")
    expect(yield* h.coordinator.isActive("ses")).toBe(false)
    expect(yield* h.coordinator.run("ses").pipe(Effect.flip)).toMatchObject({ _tag: "EngineStop.RefusedError" })
    expect(h.events).toMatchObject({ started: 0, drains: 0, settled: [] })
  }),
)
