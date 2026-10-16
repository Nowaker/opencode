import { randomUUID } from "node:crypto"
import { Effect, Schema, Scope } from "effect"
import type { PluginInput } from "@opencode-ai/plugin"
import { InstanceActivity } from "@/project/instance-activity"

export const Token = Schema.String.pipe(Schema.brand("QuiescenceToken"))
export type Token = typeof Token.Type
export const Status = Schema.Struct({
  ownerID: Schema.String,
  generation: Schema.Finite,
  sealed: Schema.Boolean,
  committed: Schema.Boolean,
  active: Schema.Finite,
}).annotate({ identifier: "OwnerQuiescenceStatus" })
export const Capability = Schema.Struct({
  ownerID: Schema.String,
  generation: Schema.Finite,
  token: Token,
}).annotate({ identifier: "OwnerQuiescenceCapability" })
export type Capability = typeof Capability.Type

export class Busy extends Schema.TaggedErrorClass<Busy>()("OwnerBusy", { active: Schema.Number }) {}
export class Sealed extends Schema.TaggedErrorClass<Sealed>()("OwnerSealed", { generation: Schema.Number }) {}
export class Stale extends Schema.TaggedErrorClass<Stale>()("OwnerQuiescenceStale", {}) {}

const ownerID = randomUUID()
const active = new Set<object>()
let generation = 0
let held: Capability | undefined
let committed = false
const deferred: (() => void)[] = []

export function status(): typeof Status.Type {
  return { ownerID, generation, sealed: held !== undefined, committed, active: active.size }
}

export function acquire(): Capability {
  if (held) throw new Sealed({ generation })
  if (active.size) throw new Busy({ active: active.size })
  generation += 1
  held = { ownerID, generation, token: Token.make(randomUUID()) }
  return held
}

export function release(capability: Capability): void {
  if (
    committed ||
    !held ||
    capability.ownerID !== ownerID ||
    capability.generation !== generation ||
    capability.token !== held.token
  )
    throw new Stale({})
  held = undefined
  for (const start of deferred.splice(0)) start()
}

export function commit(capability: Capability): boolean {
  if (!held || capability.ownerID !== ownerID || capability.generation !== generation || capability.token !== held.token)
    return false
  committed = true
  deferred.length = 0
  return true
}

export function lease() {
  const capability = acquire()
  return {
    ...capability,
    [Symbol.dispose]: () => {
      if (!committed && held === capability) release(capability)
    },
  }
}

export const control = {
  status,
  commit(capability) {
    return commit(Schema.decodeUnknownSync(Capability)(capability))
  },
  acquire() {
    try {
      return { status: "acquired", lease: lease() } as const
    } catch (error) {
      if (error instanceof Busy) return { status: "busy", active: error.active } as const
      if (error instanceof Sealed) return { status: "sealed", generation: error.generation } as const
      throw error
    }
  },
  release(capability) {
    try {
      release(Schema.decodeUnknownSync(Capability)(capability))
      return true
    } catch (error) {
      if (error instanceof Stale) return false
      throw error
    }
  },
} satisfies NonNullable<PluginInput["ownerQuiescence"]>

function enter(cleanup = false) {
  if (held && !(cleanup && committed)) throw new Sealed({ generation })
  const instance = cleanup ? undefined : InstanceActivity.enter()
  const admission = {}
  active.add(admission)
  return {
    [Symbol.dispose]: () => {
      active.delete(admission)
      instance?.[Symbol.dispose]()
    },
  }
}

export function cleanup<A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return Effect.acquireUseRelease(
    Effect.sync(() => enter(true)),
    () => work,
    (admission) => Effect.sync(() => admission[Symbol.dispose]()),
  )
}

export function cleanupPromise<A>(work: () => PromiseLike<A>): Promise<A> {
  const admission = enter(true)
  try {
    return Promise.resolve(work()).finally(() => admission[Symbol.dispose]())
  } catch (error) {
    admission[Symbol.dispose]()
    throw error
  }
}

export function activity<A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return Effect.acquireUseRelease(
    Effect.sync(enter),
    () => work,
    (admission) => Effect.sync(() => admission[Symbol.dispose]()),
  )
}

export function runPromise<A>(work: () => PromiseLike<A>): Promise<A> {
  const admission = enter()
  try {
    return Promise.resolve(work()).finally(() => admission[Symbol.dispose]())
  } catch (error) {
    admission[Symbol.dispose]()
    throw error
  }
}

export function promise<A>(work: () => PromiseLike<A>): Effect.Effect<A> {
  return Effect.promise(() => runPromise(work))
}

export function whenReleased<A>(work: () => PromiseLike<A>): Promise<A> {
  if (committed) return new Promise<A>(() => {})
  if (!held) return runPromise(work)
  return new Promise<A>((resolve, reject) => {
    deferred.push(() => {
      try {
        resolve(runPromise(work))
      } catch (error) {
        reject(error)
      }
    })
  })
}

export function fork<A, E, R>(work: Effect.Effect<A, E, R>, scope?: Scope.Scope, startImmediately = false) {
  return Effect.uninterruptible(
    Effect.gen(function* () {
      const admission = yield* Effect.sync(enter)
      const fiber = yield* work.pipe(
        (work) => (scope ? Effect.forkIn(work, scope, { startImmediately }) : Effect.forkChild(work)),
        Effect.onError(() => Effect.sync(() => admission[Symbol.dispose]())),
      )
      yield* Effect.sync(() => fiber.addObserver(() => admission[Symbol.dispose]()))
      return fiber
    }),
  )
}

export * as OwnerQuiescence from "./quiescence"
