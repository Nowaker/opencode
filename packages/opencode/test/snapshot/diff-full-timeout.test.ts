import { expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { AppProcess } from "@opencode-ai/core/process"
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Layer, Option } from "effect"
import { TestClock } from "effect/testing"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import path from "path"
import { Config } from "../../src/config/config"
import { Snapshot } from "../../src/snapshot"
import { provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"

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

for (const stalled of ["batch", "fallback"] as const) {
  it.live(`diffFull releases the store when the ${stalled} child stalls`, () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      const real = yield* ChildProcessSpawner.ChildProcessSpawner
      const started = yield* Deferred.make<ChildProcessSpawner.ChildProcessHandle>()
      const readingMetadata = yield* Deferred.make<void>()
      const resumeMetadata = yield* Deferred.make<void>()
      const spawner = ChildProcessSpawner.make(
        Effect.fnUntraced(function* (command) {
          if (!ChildProcess.isStandardCommand(command) || command.command !== "git") return yield* real.spawn(command)

          const batch = command.args.includes("--batch") && command.args.includes("cat-file")
          if (stalled === "fallback") {
            if (command.args.includes("--name-status")) {
              yield* Deferred.succeed(readingMetadata, undefined)
              yield* Deferred.await(resumeMetadata)
            }
            if (batch) {
              return yield* real.spawn(
                ChildProcess.make("git", [...command.args, "--opencode-test-invalid-option"], command.options),
              )
            }
          }

          if (stalled === "batch" ? batch : command.args.includes("show")) {
            // Keep stdout open; even if cancellation breaks, this fixture child exits on its own.
            const child = yield* real.spawn(
              ChildProcess.make(process.execPath, ["-e", "setTimeout(() => process.exit(1), 15000)"], command.options),
            )
            yield* Deferred.succeed(started, child)
            return child
          }

          return yield* real.spawn(command)
        }),
      )
      // Other fixture dependencies build AppProcess with the default spawner.
      const processLayer = Layer.fresh(realAppProcess).pipe(
        Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
      )
      const snapshotLayer = realSnapshot.pipe(
        Layer.provide([LayerNode.compile(FSUtil.node), processLayer, LayerNode.compile(Config.node)]),
      )

      yield* Effect.gen(function* () {
        const snapshot = yield* Snapshot.Service
        const before = yield* snapshot.track()
        yield* Effect.promise(() => Bun.write(path.join(directory, "new.txt"), "new content\n"))
        const after = yield* snapshot.track()
        if (!before || !after || before === after) throw new Error("fixture did not produce two different snapshots")
        yield* Effect.promise(() => Bun.write(path.join(directory, "next.txt"), "next change\n"))

        const clock = yield* TestClock.make()
        const diff = yield* snapshot
          .diffFull(before, after)
          .pipe(Effect.provideService(Clock.Clock, clock), Effect.forkScoped({ startImmediately: true }))
        const waitFor = <A>(event: Deferred.Deferred<A>, stage: string) =>
          awaitWithTimeout(
            Effect.raceFirst(
              Deferred.await(event),
              Fiber.join(diff).pipe(Effect.andThen(Effect.fail(new Error(`diffFull returned before ${stage}`)))),
            ),
            `diffFull did not reach ${stage}`,
            "5 seconds",
          )
        if (stalled === "fallback") {
          yield* waitFor(readingMetadata, "the metadata read")
          // Spend part of the locked diff budget before the batch fails and the fallback starts.
          yield* clock.adjust("20 seconds")
          yield* Deferred.succeed(resumeMetadata, undefined)
        }
        const child = yield* waitFor(started, `the stalled ${stalled} child`)
        const track = yield* snapshot.track().pipe(Effect.forkScoped({ startImmediately: true }))

        yield* clock.adjust(stalled === "batch" ? "30 seconds" : "10 seconds")

        const tracked = yield* awaitWithTimeout(
          Fiber.join(track),
          `track could not acquire the store after the ${stalled} timeout`,
          "5 seconds",
        )
        expect(tracked).toBeTruthy()
        expect(tracked).not.toBe(after)
        const outcome = yield* awaitWithTimeout(Fiber.await(diff), "diffFull did not settle")
        if (Exit.isSuccess(outcome)) throw new Error("diffFull returned a successful diff with a stalled child")
        expect(Option.getOrUndefined(Cause.findErrorOption(outcome.cause))).toMatchObject({
          _tag: "SnapshotDiffTimeout",
        })
        expect(yield* child.isRunning).toBe(false)
      }).pipe(Effect.scoped, Effect.provide(snapshotLayer), provideInstance(directory))
    }),
  )
}
