import { Context, Deferred, Effect, Fiber, Latch, Schema } from "effect"
import { InstanceRef } from "@/effect/instance-ref"
import type { InstanceContext } from "./instance-context"

export interface State {
  active: number
  revision: number
  pinned: boolean
  retired: boolean
  readonly changed: Latch.Latch
}

export interface Entry {
  readonly deferred: Deferred.Deferred<InstanceContext>
  readonly activity: State
  readonly idleTimeout?: number
  disposing?: Deferred.Deferred<void>
}

export class Retired extends Schema.TaggedErrorClass<Retired>()("InstanceRetired", {}) {}

const states = new WeakMap<InstanceContext, State>()

export const make = (pinned: boolean): State => ({
  active: 0,
  revision: 0,
  pinned,
  retired: false,
  changed: Latch.makeUnsafe(),
})

export const makeEntry = (idleTimeout?: number): Entry => ({
  deferred: Deferred.makeUnsafe<InstanceContext>(),
  activity: make(idleTimeout === undefined),
  idleTimeout,
})

export function register(ctx: InstanceContext, state: State) {
  states.set(ctx, state)
}

export const get = (ctx: InstanceContext) => states.get(ctx)

export function notify(state: State) {
  state.revision++
  state.changed.openUnsafe()
}

export function enter(state?: State) {
  const fiber = Fiber.getCurrent()
  const ctx = fiber ? Context.getReferenceUnsafe(fiber.context, InstanceRef) : undefined
  const data = state ?? (ctx ? states.get(ctx) : undefined)
  const current = data?.pinned ? undefined : data
  if (current?.retired) throw new Retired({})
  if (current) {
    current.active++
    notify(current)
  }
  let held = true
  return {
    [Symbol.dispose]() {
      if (!held) return
      held = false
      if (!current) return
      current.active--
      notify(current)
    },
  }
}

export const activity = <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => enter()),
    () => work,
    (lease) => Effect.sync(() => lease[Symbol.dispose]()),
  )

export function runPromise<A>(work: () => PromiseLike<A>): Promise<A> {
  const lease = enter()
  try {
    return Promise.resolve(work()).finally(() => lease[Symbol.dispose]())
  } catch (error) {
    lease[Symbol.dispose]()
    throw error
  }
}

export const awaitIdle = (state: State, timeout: number) =>
  Effect.gen(function* () {
    while (!state.retired && !state.pinned) {
      state.changed.closeUnsafe()
      if (state.active > 0) {
        yield* state.changed.await
        continue
      }
      const revision = state.revision
      const elapsed = yield* Effect.race(
        Effect.sleep(timeout).pipe(Effect.as(true)),
        state.changed.await.pipe(Effect.as(false)),
      )
      if (elapsed && state.revision === revision) return revision
    }
    return undefined
  })

export const watchIdle = (entry: Entry, expire: (revision: number) => Effect.Effect<void>) =>
  Effect.gen(function* () {
    if (entry.idleTimeout === undefined) return
    while (!entry.activity.retired && !entry.activity.pinned) {
      const revision = yield* awaitIdle(entry.activity, entry.idleTimeout)
      if (revision === undefined) return
      yield* expire(revision)
    }
  })

export * as InstanceActivity from "./instance-activity"
