import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { expect } from "bun:test"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { TestClock } from "effect/testing"
import { InstanceRef } from "../../src/effect/instance-ref"
import { InstanceState } from "../../src/effect/instance-state"
import { registerDisposer } from "../../src/effect/instance-registry"
import { OwnerQuiescence } from "../../src/owner/quiescence"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const Bootstrap = Context.Reference<Effect.Effect<void>>("IdleTestBootstrap", { defaultValue: () => Effect.void })
const it = testEffect(
  LayerNode.compile(LayerNode.group([InstanceStore.node, CrossSpawnSpawner.node]), [
    [InstanceStore.bootstrapNode, Layer.succeed(InstanceBootstrap.Service, { run: Effect.flatten(Bootstrap) })],
  ]),
)

const observe = (directory: string) =>
  Effect.gen(function* () {
    const disposed = yield* Deferred.make<void>()
    const calls: string[] = []
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        registerDisposer(async (input) => {
          if (input !== directory) return
          calls.push(input)
          Deferred.doneUnsafe(disposed, Effect.void)
        }),
      ),
      (off) => Effect.sync(off),
    )
    return { disposed, calls }
  })

it.effect("expires an idle generation and lazily boots the next request", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const store = yield* InstanceStore.Service
    const events = yield* observe(directory)
    const first = yield* store.acquire({ directory }, 100).pipe(Effect.scoped)
    yield* TestClock.adjust(100)
    yield* Deferred.await(events.disposed)
    const second = yield* store.acquire({ directory }, 100).pipe(Effect.scoped)
    expect(second).not.toBe(first)
    expect(events.calls).toEqual([directory])
  }),
)

it.effect("starts the full idle window after the last request releases", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const store = yield* InstanceStore.Service
    const events = yield* observe(directory)
    const request = yield* Scope.make()
    const first = yield* store.acquire({ directory }, 100).pipe(Effect.provideService(Scope.Scope, request))
    yield* TestClock.adjust(500)
    expect(events.calls).toHaveLength(0)
    expect(yield* store.acquire({ directory }, 100).pipe(Effect.scoped)).toBe(first)
    yield* Scope.close(request, Exit.void)
    yield* TestClock.adjust(99)
    expect(events.calls).toHaveLength(0)
    yield* TestClock.adjust(1)
    yield* Deferred.await(events.disposed)
  }),
)

it.effect("renews the idle deadline when another request arrives", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const store = yield* InstanceStore.Service
    const events = yield* observe(directory)
    const first = yield* store.acquire({ directory }, 100).pipe(Effect.scoped)
    yield* TestClock.adjust(80)
    expect(yield* store.acquire({ directory }, 100).pipe(Effect.scoped)).toBe(first)
    yield* TestClock.adjust(80)
    expect(events.calls).toHaveLength(0)
    yield* TestClock.adjust(20)
    yield* Deferred.await(events.disposed)
  }),
)

it.effect("keeps detached session work while another directory expires", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const other = yield* tmpdirScoped()
    const store = yield* InstanceStore.Service
    const events = yield* observe(directory)
    const idle = yield* observe(other)
    const finish = yield* Deferred.make<void>()
    const ctx = yield* store.acquire({ directory }, 100).pipe(Effect.scoped)
    const work = yield* OwnerQuiescence.fork(Deferred.await(finish), yield* Scope.Scope).pipe(
      Effect.provideService(InstanceRef, ctx),
    )
    yield* store.acquire({ directory: other }, 100).pipe(Effect.scoped)
    yield* TestClock.adjust(500)
    yield* Deferred.await(idle.disposed)
    expect(events.calls).toHaveLength(0)
    expect(work.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(finish, undefined)
    yield* Fiber.join(work)
    yield* TestClock.adjust(100)
    yield* Deferred.await(events.disposed)
  }),
)

it.effect("retains interrupted promise preparation until its underlying work settles", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const store = yield* InstanceStore.Service
    const events = yield* observe(directory)
    const started = yield* Deferred.make<void>()
    const finish = Promise.withResolvers<void>()
    const ctx = yield* store.acquire({ directory }, 100).pipe(Effect.scoped)
    const work = yield* OwnerQuiescence.promise(() => {
      Deferred.doneUnsafe(started, Effect.void)
      return finish.promise
    }).pipe(Effect.provideService(InstanceRef, ctx), Effect.forkScoped)
    yield* Deferred.await(started)
    yield* Fiber.interrupt(work)
    yield* TestClock.adjust(500)
    expect(events.calls).toHaveLength(0)
    finish.resolve()
    yield* Effect.promise(() => finish.promise)
    yield* TestClock.adjust(100)
    yield* Deferred.await(events.disposed)
  }),
)

for (const first of ["private", "http"] as const) {
  it.effect(`keeps private instances pinned when the ${first} load comes first`, () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const store = yield* InstanceStore.Service
      const events = yield* observe(directory)
      const ctx = yield* first === "private"
        ? store.load({ directory })
        : store.acquire({ directory }, 100).pipe(Effect.scoped)
      yield* store.load({ directory })
      yield* store.acquire({ directory }, 100).pipe(Effect.scoped)
      yield* TestClock.adjust(1000)
      expect(events.calls).toHaveLength(0)
      expect(yield* store.load({ directory })).toBe(ctx)
    }),
  )
}

it.effect("waits for disposal settlement before admitting a new generation", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const store = yield* InstanceStore.Service
    const started = yield* Deferred.make<void>()
    const finish = Promise.withResolvers<void>()
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        registerDisposer(async (input) => {
          if (input !== directory) return
          Deferred.doneUnsafe(started, Effect.void)
          await finish.promise
        }),
      ),
      (off) => Effect.sync(off),
    )
    const ctx = yield* store.acquire({ directory }, 100).pipe(Effect.scoped)
    yield* TestClock.adjust(100)
    yield* Deferred.await(started)
    const request = yield* store
      .acquire({ directory }, 100)
      .pipe(Effect.scoped, Effect.forkScoped({ startImmediately: true }))
    try {
      expect(request.pollUnsafe()).toBeUndefined()
    } finally {
      finish.resolve()
    }
    expect(yield* Fiber.join(request)).not.toBe(ctx)
  }),
)

it.effect("deduplicates HTTP loads while bootstrap is pending past the idle window", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const store = yield* InstanceStore.Service
    const started = yield* Deferred.make<void>()
    const finish = yield* Deferred.make<void>()
    const events = yield* observe(directory)
    const boot = Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(finish)))
    const first = yield* store
      .acquire({ directory }, 100)
      .pipe(Effect.scoped, Effect.provideService(Bootstrap, boot), Effect.forkScoped)
    yield* Deferred.await(started)
    const second = yield* store.acquire({ directory }, 100).pipe(Effect.scoped, Effect.forkScoped)
    yield* TestClock.adjust(500)
    expect(events.calls).toHaveLength(0)
    yield* Deferred.succeed(finish, undefined)
    expect(yield* Fiber.join(first)).toBe(yield* Fiber.join(second))
  }),
)

it.effect("settles a failed disposer without wedging replacement loads or other finalizers", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const store = yield* InstanceStore.Service
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        registerDisposer(() => {
          throw new Error("failed fixture cleanup")
        }),
      ),
      (off) => Effect.sync(off),
    )
    const events = yield* observe(directory)
    const first = yield* store.acquire({ directory }, 100).pipe(Effect.scoped)
    yield* TestClock.adjust(100)
    yield* Deferred.await(events.disposed)
    expect(yield* store.acquire({ directory }, 100).pipe(Effect.scoped)).not.toBe(first)
  }),
)

it.effect("drops a failed bootstrap generation before the next HTTP admission", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const store = yield* InstanceStore.Service
    let opened = 0
    let closed = 0
    const resource = yield* InstanceState.make(() =>
      Effect.gen(function* () {
        opened++
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            closed++
          }),
        )
        return opened
      }),
    )
    const failed = yield* store
      .acquire({ directory }, 100)
      .pipe(
        Effect.scoped,
        Effect.provideService(
          Bootstrap,
          InstanceState.get(resource).pipe(Effect.andThen(Effect.die(new Error("fixture bootstrap failed")))),
        ),
        Effect.exit,
      )
    expect(Exit.isFailure(failed)).toBe(true)
    expect(closed).toBe(1)
    const ctx = yield* store
      .acquire({ directory }, 100)
      .pipe(Effect.scoped, Effect.provideService(Bootstrap, InstanceState.get(resource).pipe(Effect.asVoid)))
    expect(opened).toBe(2)
    const events = yield* observe(directory)
    yield* TestClock.adjust(100)
    yield* Deferred.await(events.disposed)
    expect(yield* store.acquire({ directory }, 100).pipe(Effect.scoped)).not.toBe(ctx)
  }),
)

it.effect("preserves the HTTP idle policy across an explicit reload", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const store = yield* InstanceStore.Service
    const first = yield* store.acquire({ directory }, 100).pipe(Effect.scoped)
    const second = yield* store.reload({ directory })
    expect(second).not.toBe(first)
    const events = yield* observe(directory)
    yield* TestClock.adjust(100)
    yield* Deferred.await(events.disposed)
    expect(yield* store.acquire({ directory }, 100).pipe(Effect.scoped)).not.toBe(second)
  }),
)
