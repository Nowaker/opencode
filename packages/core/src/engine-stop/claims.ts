import { EngineStop } from "@opencode/schema/engine-stop"
import { Context, Data, Effect, Exit, Scope, type Fiber } from "effect"
import { State, type Owner } from "./state.js"

const ReservationTypeId: unique symbol = Symbol("EngineStop.Reservation")

export class OwnershipError extends Data.TaggedError("EngineStop.OwnershipError")<{
  readonly reason: "expired-reservation" | "no-current-owner"
}> {}

/** A scoped, single-use capability, independent of inherited or replaced Context. */
export interface Reservation {
  readonly [ReservationTypeId]: typeof ReservationTypeId
  readonly release: Effect.Effect<void>
  readonly run: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    shutdown?: Effect.Effect<void>,
  ) => Effect.Effect<A, E | OwnershipError, R>
  readonly fork: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    scope: Scope.Scope,
    shutdown?: Effect.Effect<void>,
  ) => Effect.Effect<Fiber.Fiber<A, E | OwnershipError>, OwnershipError, R>
}

const Current = Context.Reference<{ readonly state: State; readonly owner: Owner } | undefined>(
  "@opencode/EngineStop/Current",
  { defaultValue: () => undefined },
)

export function make(state: State) {
  const current = (fiber: Fiber.Fiber<unknown, unknown>) => {
    const value = fiber.getRef(Current)
    if (value?.state !== state || value.owner.fiber !== fiber || fiber.pollUnsafe() !== undefined) return
    return state.owners.get(value.owner.key) === value.owner ? value.owner : undefined
  }
  const release = (owner: Owner) => Effect.sync(() => state.release(owner))
  const bind = (owner: Owner, fiber: Fiber.Fiber<unknown, unknown>, shutdown?: Effect.Effect<void>) => {
    const bound: Owner = {
      key: owner.key,
      shutdown: owner.shutdown,
      fiber,
      cancel: Effect.setContext(
        shutdown ??
          Effect.sync(() => {
            if (state.owners.get(owner.key) === bound) fiber.interruptUnsafe()
          }),
        fiber.context,
      ),
    }
    state.enter(bound)
    return bound
  }
  const acquire = (fiber: Fiber.Fiber<unknown, unknown>, shutdown?: Effect.Effect<void>) =>
    Effect.suspend(() => {
      const refusal = state.refusal()
      if (refusal) return Effect.fail(refusal)
      return Effect.succeed(bind({ key: Symbol(), shutdown: { requested: false } }, fiber, shutdown))
    })
  const withWork = <A, E, R>(effect: Effect.Effect<A, E, R>, shutdown?: Effect.Effect<void>) =>
    Effect.withFiber((fiber) =>
      Effect.acquireUseRelease(
        acquire(fiber, shutdown),
        (owner) => Effect.provideService(effect, Current, { state, owner }),
        release,
      ),
    )
  const within = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.withFiber((fiber) => (current(fiber) ? effect : withWork(effect)))
  const unclaimed = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provideService(effect, Current, undefined)

  const reservation = (owner: Owner): Reservation => {
    const run = <A, E, R>(effect: Effect.Effect<A, E, R>, shutdown?: Effect.Effect<void>) =>
      Effect.withFiber((fiber) =>
        Effect.acquireUseRelease(
          Effect.suspend(() =>
            state.owners.get(owner.key) === owner
              ? Effect.succeed(bind(owner, fiber, shutdown))
              : Effect.fail(new OwnershipError({ reason: "expired-reservation" })),
          ),
          (bound) => Effect.provideService(effect, Current, { state, owner: bound }),
          release,
        ),
      )
    return {
      [ReservationTypeId]: ReservationTypeId,
      release: release(owner),
      run,
      fork: (effect, scope, shutdown) =>
        Effect.uninterruptible(
          Effect.suspend(() => {
            if (state.owners.get(owner.key) !== owner)
              return Effect.fail(new OwnershipError({ reason: "expired-reservation" }))
            const pending: Owner = { key: owner.key, shutdown: owner.shutdown }
            state.enter(pending)
            return Effect.forkIn(reservation(pending).run(effect, shutdown), scope).pipe(
              Effect.tap((fiber) => Effect.sync(() => fiber.addObserver(() => state.release(pending)))),
              Effect.onExit((exit) => (Exit.isFailure(exit) ? release(pending) : Effect.void)),
            )
          }),
        ),
    }
  }

  const reserve = (kind: "fresh" | "retain" | "transfer") =>
    Effect.uninterruptible(
      Effect.withFiber((fiber) =>
        Effect.gen(function* () {
          const previous = current(fiber)
          if (kind === "transfer" && !previous) return yield* new OwnershipError({ reason: "no-current-owner" })
          if (kind === "fresh" || !previous) {
            const refusal = state.refusal()
            if (refusal) return yield* refusal
          }
          const owner: Owner = {
            key: kind === "transfer" && previous ? previous.key : Symbol(),
            shutdown: kind !== "fresh" && previous ? previous.shutdown : { requested: false },
          }
          state.enter(owner)
          yield* Effect.addFinalizer(() => release(owner))
          return reservation(owner)
        }),
      ),
    )

  return {
    withWork,
    within,
    unclaimed,
    shutdownRequested: Effect.withFiber((fiber) =>
      Effect.suspend(() => {
        const owner = current(fiber)
        return owner
          ? Effect.succeed(owner.shutdown.requested)
          : Effect.fail(new OwnershipError({ reason: "no-current-owner" }))
      }),
    ),
    // Ends the calling fiber's own claim before its scope does, so the work's completion is never observable
    // while it still counts as active.
    releaseCurrent: Effect.withFiber((fiber) =>
      Effect.sync(() => {
        const owner = current(fiber)
        if (owner) state.release(owner)
      }),
    ),
    reserve: () => reserve("fresh"),
    retain: () => reserve("retain"),
    transfer: () => reserve("transfer"),
    check: (admission?: EngineStop.RefusedError["admission"]) =>
      Effect.suspend(() => {
        const refusal = state.refusal(admission)
        return refusal ? Effect.fail(refusal) : Effect.void
      }),
  }
}
