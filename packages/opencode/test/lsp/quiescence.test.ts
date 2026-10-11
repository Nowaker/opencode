import { expect, spyOn } from "bun:test"
import path from "node:path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Fiber, Layer } from "effect"
import { LSP } from "../../src/lsp/lsp"
import { Typescript } from "../../src/lsp/server"
import { OwnerQuiescence } from "../../src/owner/quiescence"
import { TestInstance } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(LayerNode.compile(LSP.node), LayerNode.compile(CrossSpawnSpawner.node)))

it.instance("interrupted LSP preparation stays busy until its native spawn promise settles", () =>
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const directory = (yield* TestInstance).directory
    const ready = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    const settled = Promise.withResolvers<void>()
    const spy = spyOn(Typescript, "spawn").mockImplementation(async () => {
      ready.resolve()
      await finish.promise
      settled.resolve()
      return undefined
    })
    try {
      const fiber = yield* lsp.touchFile(path.join(directory, "test.ts")).pipe(Effect.forkChild)
      yield* Effect.promise(() => ready.promise)
      yield* Fiber.interrupt(fiber)
      expect(() => {
        using seal = OwnerQuiescence.lease()
        return seal
      }).toThrow(OwnerQuiescence.Busy)
      finish.resolve()
      yield* Effect.promise(() => settled.promise)
      yield* pollWithTimeout(Effect.sync(() => OwnerQuiescence.status().active === 0 ? true : undefined), "spawn did not settle")
      using seal = OwnerQuiescence.lease()
      expect(OwnerQuiescence.status().active).toBe(0)
    } finally {
      finish.resolve()
      spy.mockRestore()
    }
  }), { git: true, config: { lsp: true } },
)
