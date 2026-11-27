import { expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Layer, Option, Ref } from "effect"
import { TestClock } from "effect/testing"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import path from "path"
import { Snapshot } from "../../src/snapshot"
import { TestInstance } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(CrossSpawnSpawner.node))

// Rebuild the real Snapshot and AppProcess against this fixture's spawner, not the fixture's cached default.
const snapshotLayer = (spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]) =>
  Layer.fresh(
    LayerNode.compile(Snapshot.node, [
      [CrossSpawnSpawner.node, Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)],
    ]),
  )

for (const stalled of ["batch", "fallback"] as const) {
  it.instance(
    `diffFull times out and reaps a stalled ${stalled} child before tracking resumes`,
    Effect.gen(function* () {
      const test = yield* TestInstance
      const real = yield* ChildProcessSpawner.ChildProcessSpawner
      const started = yield* Deferred.make<ChildProcessSpawner.ChildProcessHandle>()
      const readingMetadata = yield* Deferred.make<void>()
      const resumeMetadata = yield* Deferred.make<void>()
      const runningAtTrack = yield* Deferred.make<boolean>()
      const spawner = ChildProcessSpawner.make(
        Effect.fnUntraced(function* (command) {
          if (!ChildProcess.isStandardCommand(command) || command.command !== "git") return yield* real.spawn(command)

          const batch = command.args.includes("cat-file") && command.args.includes("--batch")
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
            // Leave stdout open, but let the fixture quit on its own if cleanup fails.
            const child = yield* real.spawn(
              ChildProcess.make(process.execPath, ["-e", "setTimeout(() => process.exit(1), 15000)"], command.options),
            )
            yield* Deferred.succeed(started, child)
            return child
          }

          if (command.args.includes("--git-path") && (yield* Deferred.isDone(started))) {
            const child = yield* Deferred.await(started)
            yield* Deferred.succeed(runningAtTrack, yield* child.isRunning)
          }
          return yield* real.spawn(command)
        }),
      )

      yield* Effect.gen(function* () {
        const snapshot = yield* Snapshot.Service
        const before = yield* snapshot.track()
        yield* Effect.promise(() => Bun.write(path.join(test.directory, "new.txt"), "new content\n"))
        const after = yield* snapshot.track()
        if (!before || !after || before === after) throw new Error("fixture did not produce two different snapshots")
        yield* Effect.promise(() => Bun.write(path.join(test.directory, "next.txt"), "next change\n"))

        const clock = yield* TestClock.make()
        const diff = yield* snapshot.diffFull(before, after).pipe(
          Effect.provideService(Clock.Clock, clock),
          Effect.forkScoped({ startImmediately: true }),
        )
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
          yield* clock.adjust("20 seconds")
          yield* Deferred.succeed(resumeMetadata, undefined)
        }
        yield* waitFor(started, `the stalled ${stalled} child`)
        const track = yield* snapshot.track().pipe(Effect.forkScoped({ startImmediately: true }))

        yield* clock.adjust(stalled === "batch" ? "30 seconds" : "10 seconds")

        const tracked = yield* awaitWithTimeout(
          Fiber.join(track),
          "track could not acquire the store after timeout",
          "5 seconds",
        )
        expect(tracked).toBeTruthy()
        expect(tracked).not.toBe(after)
        expect(
          yield* awaitWithTimeout(Deferred.await(runningAtTrack), "track never reached its first git command"),
        ).toBe(false)
        const outcome = yield* awaitWithTimeout(Fiber.await(diff), "diffFull did not settle")
        if (Exit.isSuccess(outcome)) throw new Error("diffFull returned a successful diff with a stalled child")
        expect(Option.getOrUndefined(Cause.findErrorOption(outcome.cause))).toMatchObject({
          _tag: "SnapshotDiffTimeout",
          from: before,
          to: after,
        })
      }).pipe(Effect.scoped, Effect.provide(snapshotLayer(spawner)))
    }),
    { git: true },
  )
}

it.instance(
  "track does not return a stale tree when staging fails",
  Effect.gen(function* () {
    const test = yield* TestInstance
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

    yield* Effect.gen(function* () {
      const snapshot = yield* Snapshot.Service
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "original.txt"), "original content\n"))
      expect(yield* snapshot.track()).toBeTruthy()
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "new.txt"), "new content\n"))
      rejectStaging = true

      const tracked = yield* snapshot.track()
      const child = yield* Ref.get(invalidAdd)
      if (child === undefined) throw new Error("fixture did not run the invalid git add")
      expect(yield* child.exitCode, "invalid git add did not fail").toBeGreaterThan(0)
      expect(tracked).toBeUndefined()
    }).pipe(Effect.provide(snapshotLayer(spawner)))
  }),
  { git: true },
)
