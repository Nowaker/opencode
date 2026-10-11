import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Fiber, Layer } from "effect"
import { InstanceStore } from "../../src/project/instance-store"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { registerDisposer } from "../../src/effect/instance-registry"
import { OwnerQuiescence } from "../../src/owner/quiescence"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([InstanceStore.node, CrossSpawnSpawner.node]), [
    [InstanceStore.bootstrapNode, Layer.succeed(InstanceBootstrap.Service, { run: Effect.void })],
  ]),
)

for (const method of ["dispose", "disposeDirectory"] as const) {
  it.live(`${method} remains busy through interrupted disposer settlement and cache removal`, () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const ctx = yield* store.load({ directory })
      const ready = Promise.withResolvers<void>()
      const finish = Promise.withResolvers<void>()
      const unregister = registerDisposer(async (input) => {
        if (input !== directory) return
        ready.resolve()
        await finish.promise
      })
      yield* Effect.addFinalizer(() => Effect.sync(unregister))
      const disposal = yield* (method === "dispose" ? store.dispose(ctx) : store.disposeDirectory(directory)).pipe(
        Effect.forkChild,
      )
      yield* Effect.promise(() => ready.promise)
      yield* Effect.sync(() => disposal.interruptUnsafe())
      try {
        expect(() => {
          using seal = OwnerQuiescence.lease()
          return seal
        }).toThrow(OwnerQuiescence.Busy)
      } finally {
        finish.resolve()
      }
      yield* Fiber.await(disposal)
      {
        using seal = OwnerQuiescence.lease()
        expect(OwnerQuiescence.status().active).toBe(0)
      }
      expect(yield* store.load({ directory })).not.toBe(ctx)
    }),
  )
}
