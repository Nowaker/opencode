import { expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppProcess } from "@opencode-ai/core/process"
import { Deferred, Effect, Exit, Fiber, Layer, Logger, Ref, Scheduler } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import path from "path"
import { Snapshot } from "../../src/snapshot"
import { snapshotWriters } from "../../src/snapshot/writers"
import { provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node, AppProcess.node])),
    testInstanceStoreLayer,
  ),
)

const witness = "witness.txt"
const original = "original\n"
const changed = "changed after diff acquired the store\n"

type HeldStore = {
  readonly directory: string
  readonly snapshot: Snapshot.Interface
  readonly originalTree: string
  readonly release: Effect.Effect<void>
  readonly writeTreeStarted: Effect.Effect<void>
  readonly releaseWriteTree: Effect.Effect<void>
  readonly captures: Effect.Effect<number>
  readonly writeWitness: (text: string) => Effect.Effect<void>
  readonly readWitness: Effect.Effect<string>
  readonly readTree: (tree: string | undefined) => Effect.Effect<string, AppProcess.AppProcessError>
}

const withStoreHeld = <E, R>(
  check: (store: HeldStore) => Effect.Effect<void, E, R>,
  options?: { readonly holdWriteTree: boolean },
) =>
  awaitWithTimeout(
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      const real = yield* ChildProcessSpawner.ChildProcessSpawner
      const appProcess = yield* AppProcess.Service
      const held = yield* Deferred.make<string>()
      const release = yield* Deferred.make<void>()
      const writeTreeStarted = yield* Deferred.make<void>()
      const writeTreeReleased = yield* Deferred.make<void>()
      const releaseWriteTree = Deferred.succeed(writeTreeReleased, undefined).pipe(Effect.asVoid)
      const captures = yield* Ref.make(0)
      const spawner = ChildProcessSpawner.make(
        Effect.fnUntraced(function* (command) {
          if (
            ChildProcess.isStandardCommand(command) &&
            command.command === "git" &&
            command.options.cwd === directory
          ) {
            const at = command.args.indexOf("--git-dir")
            const gitdir = command.args[at + 1]
            if (at >= 0 && gitdir && command.args[at + 2] === "--work-tree" && command.args[at + 3] === directory) {
              const operation = command.args[at + 4]
              if (operation === "diff" && command.args[at + 5] === "--cached") {
                yield* Deferred.succeed(held, gitdir)
                yield* Deferred.await(release)
              }
              if (operation === "write-tree") {
                if (options?.holdWriteTree && (yield* Deferred.isDone(held))) {
                  yield* Deferred.succeed(writeTreeStarted, undefined)
                  yield* Deferred.await(writeTreeReleased)
                }
                return yield* real.spawn(command).pipe(Effect.tap(() => Ref.update(captures, (n) => n + 1)))
              }
            }
          }
          return yield* real.spawn(command)
        }),
      )
      // Instance discovery and blob reads keep their default process services.
      const processLayer = Layer.fresh(
        LayerNode.compile(AppProcess.node, [
          [CrossSpawnSpawner.node, Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)],
        ]),
      )
      const snapshotLayer = LayerNode.compile(Snapshot.node, [[AppProcess.node, processLayer]])

      yield* Effect.gen(function* () {
        const snapshot = yield* Snapshot.Service
        const file = path.join(directory, witness)
        const writeWitness = (text: string) => Effect.promise(() => Bun.write(file, text)).pipe(Effect.asVoid)
        yield* writeWitness(original)
        const originalTree = yield* snapshot.track()
        if (!originalTree) throw new Error("could not seed the snapshot store")
        yield* Ref.set(captures, 0)

        const holder = yield* snapshot.diff(originalTree).pipe(Effect.forkScoped)
        const gitdir = yield* awaitWithTimeout(
          Effect.raceFirst(
            Deferred.await(held),
            Fiber.join(holder).pipe(
              Effect.andThen(Effect.fail(new Error("diff finished without reaching the gate"))),
            ),
          ),
          "diff did not acquire the snapshot store",
          "5 seconds",
        )
        yield* writeWitness(changed)

        yield* check({
          directory,
          snapshot,
          originalTree,
          release: Deferred.succeed(release, undefined).pipe(Effect.andThen(Fiber.join(holder)), Effect.asVoid),
          writeTreeStarted: Deferred.await(writeTreeStarted),
          releaseWriteTree,
          captures: Ref.get(captures),
          writeWitness,
          readWitness: Effect.promise(() => Bun.file(file).text()),
          readTree: (tree) => {
            if (!tree) throw new Error("track did not return a tree")
            return appProcess
              .run(ChildProcess.make("git", ["--git-dir", gitdir, "show", `${tree}:${witness}`], { cwd: directory }))
              .pipe(Effect.flatMap(AppProcess.requireSuccess), Effect.map((result) => result.stdout.toString("utf8")))
          },
        })
      }).pipe(
        Effect.ensuring(Deferred.succeed(release, undefined).pipe(Effect.andThen(releaseWriteTree))),
        Effect.scoped,
        Effect.provide(snapshotLayer),
        provideInstance(directory),
      )
    }).pipe(Effect.scoped),
    "queued snapshot scenario did not settle",
    "15 seconds",
  )

// The warm Snapshot and Config caches leave no suspension before store admission.
// Run each fiber to that wait before starting the next; do not race a scheduler yield.
const forkQueued = <A>(operation: Effect.Effect<A>) =>
  operation.pipe(
    Effect.provideService(Scheduler.PreventSchedulerYield, true),
    Effect.forkScoped({ startImmediately: true }),
  )

it.live("adjacent queued tracks share one capture of the current files", () => {
  const receipts: object[] = []
  const logger = Logger.make(({ message }) => {
    const [event, fields]: readonly unknown[] = Array.isArray(message) ? message : [message]
    if (event !== "snapshot op" || fields === null || typeof fields !== "object") return
    if ("op" in fields && fields.op === "track") receipts.push(fields)
  })

  return withStoreHeld((store) =>
    Effect.gen(function* () {
      receipts.length = 0
      const first = yield* forkQueued(store.snapshot.track("ses_first"))
      const second = yield* forkQueued(store.snapshot.track("ses_second"))
      const third = yield* forkQueued(store.snapshot.track("ses_third"))
      yield* store.release

      const tree = yield* Fiber.join(first)
      expect(yield* Fiber.joinAll([second, third])).toEqual([tree, tree])
      expect(yield* store.readTree(tree)).toBe(changed)
      expect(yield* store.captures).toBe(1)
      expect(receipts).toEqual([expect.objectContaining({ cohort_size: 3, join_count: 2 })])
    }),
  ).pipe(Effect.provideService(Logger.CurrentLoggers, new Set([logger])))
})

it.live("track arriving after staging captures the updated worktree separately", () =>
  withStoreHeld(
    (store) =>
      Effect.gen(function* () {
        const first = yield* forkQueued(store.snapshot.track("ses_staged"))
        yield* store.release
        yield* awaitWithTimeout(store.writeTreeStarted, "first track did not finish staging", "5 seconds")

        const lateContents = "new witness\n"
        yield* store.writeWitness(lateContents)
        const late = yield* forkQueued(store.snapshot.track("ses_late"))
        yield* store.releaseWriteTree

        const firstTree = yield* Fiber.join(first)
        const lateTree = yield* Fiber.join(late)
        expect(lateTree).not.toBe(firstTree)
        expect(yield* store.readTree(firstTree)).toBe(changed)
        expect(yield* store.readTree(lateTree)).toBe(lateContents)
        expect(yield* store.captures).toBe(2)
      }),
    { holdWriteTree: true },
  ),
)

it.live("a queued restore separates two track cohorts with different tree contents", () =>
  withStoreHeld((store) =>
    Effect.gen(function* () {
      const before = yield* forkQueued(store.snapshot.track("ses_before"))
      const beforePeer = yield* forkQueued(store.snapshot.track("ses_before_peer"))
      const writer = yield* forkQueued(store.snapshot.restore(store.originalTree))
      const after = yield* forkQueued(store.snapshot.track("ses_after"))
      const afterPeer = yield* forkQueued(store.snapshot.track("ses_after_peer"))
      yield* store.release
      yield* Fiber.join(writer)

      const beforeTree = yield* Fiber.join(before)
      const afterTree = yield* Fiber.join(after)
      expect(yield* Fiber.join(beforePeer)).toBe(beforeTree)
      expect(yield* Fiber.join(afterPeer)).toBe(afterTree)
      expect(yield* store.readTree(beforeTree)).toBe(changed)
      expect(yield* store.readTree(afterTree)).toBe(original)
      expect(yield* store.captures).toBe(2)
    }),
  ),
)

it.live("a known write during a shared capture forces both tracks to recapture before a queued restore", () =>
  withStoreHeld(
    (store) =>
      Effect.gen(function* () {
        const first = yield* forkQueued(store.snapshot.track("ses_shared_first"))
        const second = yield* forkQueued(store.snapshot.track("ses_shared_second"))
        yield* store.release
        yield* awaitWithTimeout(store.writeTreeStarted, "shared capture did not finish staging", "5 seconds")

        const updated = "known writer's updated witness\n"
        yield* snapshotWriters.hold(store.directory, store.writeWitness(updated))
        const restore = yield* forkQueued(store.snapshot.restore(store.originalTree))
        yield* store.releaseWriteTree

        const firstTree = yield* Fiber.join(first)
        const secondTree = yield* Fiber.join(second)
        yield* Fiber.join(restore)
        expect(yield* store.readTree(firstTree)).toBe(updated)
        expect(yield* store.readTree(secondTree)).toBe(updated)
        expect(yield* store.readWitness).toBe(original)
        expect(yield* store.captures).toBe(3)
      }),
    { holdWriteTree: true },
  ),
)

it.live("interrupting the first queued track leaves its sibling's capture intact", () =>
  withStoreHeld((store) =>
    Effect.gen(function* () {
      const first = yield* forkQueued(store.snapshot.track("ses_cancelled"))
      const sibling = yield* forkQueued(store.snapshot.track("ses_survivor"))
      yield* awaitWithTimeout(Fiber.interrupt(first), "first track did not cancel while the store was held")
      expect(Exit.hasInterrupts(yield* Fiber.await(first))).toBe(true)
      expect(yield* store.captures).toBe(0)
      yield* store.release

      expect(yield* store.readTree(yield* Fiber.join(sibling))).toBe(changed)
      expect(yield* store.captures).toBe(1)
    }),
  ),
)
