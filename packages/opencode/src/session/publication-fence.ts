import { Context, Effect, Latch, Semaphore } from "effect"

type Lease = { readonly fence: object; active: boolean; readonly parent?: Lease }
const Current = Context.Reference<Lease | undefined>("opencode/PublicationLease", { defaultValue: () => undefined })

export function make() {
  const identity = {}
  const snapshots = Semaphore.makeUnsafe(1)
  let gate: Latch.Latch | undefined
  let drained: Latch.Latch | undefined
  let active = 0

  return {
    guard<A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
      return Effect.gen(function* () {
        const parent = yield* Current
        for (let lease = parent; lease; lease = lease.parent) {
          if (lease.fence === identity && lease.active) return yield* work
        }
        return yield* Effect.acquireUseRelease(
          Effect.gen(function* () {
            while (gate) yield* gate.await
            active++
            return { fence: identity, active: true, parent }
          }),
          (lease) => work.pipe(Effect.provideService(Current, lease)),
          (lease) =>
            Effect.sync(() => {
              lease.active = false
              if (--active === 0) drained?.openUnsafe()
            }),
        )
      })
    },
    snapshot<A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
      return snapshots.withPermit(
        Effect.acquireUseRelease(
          Effect.sync(() => {
            gate = Latch.makeUnsafe()
            drained = Latch.makeUnsafe(active === 0)
            return drained
          }),
          (ready) => ready.await.pipe(Effect.andThen(work)),
          () =>
            Effect.sync(() => {
              const closed = gate
              gate = undefined
              drained = undefined
              closed?.openUnsafe()
            }),
        ),
      )
    },
  }
}

export * as PublicationFence from "./publication-fence"
