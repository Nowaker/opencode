import { expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { AppProcess } from "@opencode-ai/core/process"
import { Effect, Layer, Ref } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import path from "path"
import { Config } from "../../src/config/config"
import { Snapshot } from "../../src/snapshot"
import { provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(LayerNode.compile(CrossSpawnSpawner.node), testInstanceStoreLayer))
const realSnapshot = Snapshot.node.implementation as Layer.Layer<
  Snapshot.Service,
  never,
  FSUtil.Service | AppProcess.Service | Config.Service
>
const realAppProcess = AppProcess.node.implementation as Layer.Layer<
  AppProcess.Service,
  never,
  ChildProcessSpawner.ChildProcessSpawner
>

it.live("track does not return the previous tree when staging fails", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped({ git: true })
    const real = yield* ChildProcessSpawner.ChildProcessSpawner
    const invalidAdd = yield* Ref.make<ChildProcessSpawner.ChildProcessHandle | undefined>(undefined)
    let rejectStaging = false
    const spawner = ChildProcessSpawner.make((command) => {
      if (
        rejectStaging &&
        ChildProcess.isStandardCommand(command) &&
        command.command === "git" &&
        command.args.includes("add") &&
        command.args.includes("--pathspec-file-nul")
      ) {
        return real
          .spawn(ChildProcess.make("git", [...command.args, "--opencode-test-invalid-option"], command.options))
          .pipe(Effect.tap((child) => Ref.set(invalidAdd, child)))
      }
      return real.spawn(command)
    })
    const processLayer = Layer.fresh(realAppProcess).pipe(
      Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
    )
    const snapshotLayer = realSnapshot.pipe(
      Layer.provide([LayerNode.compile(FSUtil.node), processLayer, LayerNode.compile(Config.node)]),
    )

    yield* Effect.gen(function* () {
      const snapshot = yield* Snapshot.Service
      yield* Effect.promise(() => Bun.write(path.join(directory, "original.txt"), "original content\n"))
      expect(yield* snapshot.track()).toBeTruthy()
      yield* Effect.promise(() => Bun.write(path.join(directory, "new.txt"), "new content\n"))
      rejectStaging = true

      const tracked = yield* snapshot.track()
      const child = yield* Ref.get(invalidAdd)
      if (child === undefined) throw new Error("fixture did not run the invalid git add")
      expect(yield* child.exitCode, "invalid git add did not fail").toBeGreaterThan(0)
      expect(tracked).toBe("")
    }).pipe(Effect.scoped, Effect.provide(snapshotLayer), provideInstance(directory))
  }),
)
