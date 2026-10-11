import { strictEqual, deepStrictEqual, throws } from "node:assert"
import { Deferred, Effect, Exit, Fiber, Scope } from "effect"
import { OwnerQuiescence } from "../../src/owner/quiescence"
import { BackgroundJob } from "@opencode-ai/core/background-job"
import { pollWithTimeout } from "../lib/effect"

const scenarios: { readonly name: string; readonly run: () => void | Promise<void> }[] = []
function test(name: string, run: () => void | Promise<void>) {
  scenarios.push({ name, run })
}

test("acquisition refuses preparation before its first asynchronous boundary", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const ready = yield* Deferred.make<void>()
        const finish = yield* Deferred.make<void>()
        const fiber = yield* OwnerQuiescence.activity(
          Deferred.succeed(ready, undefined).pipe(Effect.andThen(Deferred.await(finish))),
        ).pipe(Effect.forkChild)
        yield* Deferred.await(ready)
        throws(() => OwnerQuiescence.acquire(), OwnerQuiescence.Busy)
        yield* Deferred.succeed(finish, undefined)
        yield* Fiber.join(fiber)
      }),
    ),
  )
})

test("seal refuses work before its side effects and release restores admission", async () => {
  const effects: string[] = []
  {
    using seal = OwnerQuiescence.lease()
    const exit = await Effect.runPromiseExit(OwnerQuiescence.activity(Effect.sync(() => effects.push("ran"))))
    strictEqual(exit._tag, "Failure")
    strictEqual(effects.length, 0)
  }
  await Effect.runPromise(OwnerQuiescence.activity(Effect.sync(() => effects.push("ran"))))
  deepStrictEqual(effects, ["ran"])
})

test("stale capability cannot release a later generation", () => {
  const prior = OwnerQuiescence.acquire()
  OwnerQuiescence.release(prior)
  using current = OwnerQuiescence.lease()
  throws(() => OwnerQuiescence.release(prior), OwnerQuiescence.Stale)
  strictEqual(OwnerQuiescence.status().sealed, true)
})

test("fork reserves admission before detached work starts and preserves active work", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const scope = yield* Scope.Scope
        const done = yield* Deferred.make<void>()
        const fiber = yield* OwnerQuiescence.fork(Deferred.await(done).pipe(Effect.as("completed")), scope)
        throws(() => OwnerQuiescence.acquire(), OwnerQuiescence.Busy)
        yield* Deferred.succeed(done, undefined)
        strictEqual(yield* Fiber.join(fiber), "completed")
      }),
    ),
  )
  using seal = OwnerQuiescence.lease()
})

test("admission is released after interruption and scoped child teardown", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const scope = yield* Scope.Scope
        const fiber = yield* OwnerQuiescence.fork(Effect.never, scope)
        yield* Fiber.interrupt(fiber)
      }),
    ),
  )
  using seal = OwnerQuiescence.lease()
})

test("simultaneous idle acquisition produces only one valid capability", () => {
  using seal = OwnerQuiescence.lease()
  throws(() => OwnerQuiescence.acquire(), OwnerQuiescence.Sealed)
})

test("closed destination scope does not leak a fork admission", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      yield* Scope.close(scope, Exit.void)
      const fiber = yield* OwnerQuiescence.fork(Effect.never, scope)
      yield* Fiber.await(fiber)
    }),
  )
  using seal = OwnerQuiescence.lease()
})

test("plugin lease disposal is idempotent after explicit CAS release", () => {
  const acquired = OwnerQuiescence.control.acquire()
  strictEqual(acquired.status, "acquired")
  if (acquired.status !== "acquired") return
  using lease = acquired.lease
  strictEqual(OwnerQuiescence.control.release(lease), true)
  using successor = OwnerQuiescence.lease()
  lease[Symbol.dispose]()
  strictEqual(OwnerQuiescence.control.release(lease), false)
  strictEqual(OwnerQuiescence.status().sealed, true)
})

test("interruption cannot hide still-executing asynchronous preparation", async () => {
  const ready = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fiber = yield* OwnerQuiescence.promise(async () => {
          ready.resolve()
          await finish.promise
        }).pipe(Effect.forkChild)
        yield* Effect.promise(() => ready.promise)
        yield* Fiber.interrupt(fiber)
        throws(() => OwnerQuiescence.acquire(), OwnerQuiescence.Busy)
        finish.resolve()
        yield* pollWithTimeout(
          Effect.sync(() => (OwnerQuiescence.status().active === 0 ? true : undefined)),
          "preparation did not settle",
        )
      }),
    ),
  )
  using seal = OwnerQuiescence.lease()
})

test("queued background extensions stay owned until their execution settles", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const jobs = yield* BackgroundJob.makeWithFork((work, scope) =>
          OwnerQuiescence.fork(work, scope).pipe(Effect.asVoid),
        )
        const first = yield* Deferred.make<void>()
        const second = yield* Deferred.make<void>()
        const started = yield* Deferred.make<void>()
        const job = yield* jobs.start({ type: "probe", run: Deferred.await(first).pipe(Effect.as("first")) })
        yield* jobs.extend({
          id: job.id,
          run: Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(second)), Effect.as("second")),
        })
        yield* Deferred.succeed(first, undefined)
        yield* Deferred.await(started)
        throws(() => OwnerQuiescence.acquire(), OwnerQuiescence.Busy)
        yield* Deferred.succeed(second, undefined)
        const result = yield* jobs.wait({ id: job.id })
        strictEqual(result.info?.output, "second")
      }),
    ),
  )
  using seal = OwnerQuiescence.lease()
})

test("retirement waits for interrupted work to finish its cleanup", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const scope = yield* Scope.Scope
    const ready = yield* Deferred.make<void>()
    const cleanup = yield* Deferred.make<void>()
    const finish = yield* Deferred.make<void>()
    const fiber = yield* OwnerQuiescence.fork(Deferred.succeed(ready, undefined).pipe(
      Effect.andThen(Effect.never),
      Effect.ensuring(Deferred.succeed(cleanup, undefined).pipe(Effect.andThen(Deferred.await(finish)))),
    ), scope)
    yield* Deferred.await(ready)
    const interruption = yield* Fiber.interrupt(fiber).pipe(Effect.forkChild)
    yield* Deferred.await(cleanup)
    throws(() => OwnerQuiescence.acquire(), OwnerQuiescence.Busy)
    yield* Deferred.succeed(finish, undefined)
    yield* Fiber.join(interruption)
  })))
  using seal = OwnerQuiescence.lease()
})

test("release reserves queued event admission before returning", async () => {
  const finish = Promise.withResolvers<void>()
  const delivered: number[] = []
  const capability = OwnerQuiescence.acquire()
  const first = OwnerQuiescence.whenReleased(async () => {
    delivered.push(1)
    await finish.promise
  })
  const second = OwnerQuiescence.whenReleased(async () => { delivered.push(2) })
  deepStrictEqual(delivered, [])
  OwnerQuiescence.release(capability)
  deepStrictEqual(delivered, [1, 2])
  throws(() => OwnerQuiescence.acquire(), OwnerQuiescence.Busy)
  finish.resolve()
  await Promise.all([first, second])
  using seal = OwnerQuiescence.lease()
})

test("completed background jobs retain ownership through detached scope finalization", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const ready = yield* Deferred.make<void>()
    const finish = yield* Deferred.make<void>()
    let first = true
    const jobs = yield* BackgroundJob.makeWithFork((work, scope) => Effect.gen(function* () {
      if (first) {
        first = false
        yield* Scope.addFinalizer(scope, Deferred.succeed(ready, undefined).pipe(Effect.andThen(Deferred.await(finish))))
      }
      yield* OwnerQuiescence.fork(work, scope)
    }))
    const job = yield* jobs.start({ type: "cleanup", run: Effect.succeed("finished") })
    yield* jobs.wait({ id: job.id })
    yield* Deferred.await(ready)
    try {
      throws(() => OwnerQuiescence.acquire(), OwnerQuiescence.Busy)
    } finally {
      Deferred.doneUnsafe(finish, Effect.void)
    }
  })))
  using seal = OwnerQuiescence.lease()
})

test("commit is exact and irreversible through release, disposal, deferred events and cleanup", async () => {
  const acquired = OwnerQuiescence.control.acquire()
  if (acquired.status !== "acquired") throw new Error(acquired.status)
  const lease = acquired.lease
  const delivered: number[] = []
  void OwnerQuiescence.whenReleased(async () => { delivered.push(1) })
  for (const stale of [
    { ...lease, ownerID: "other" },
    { ...lease, generation: lease.generation + 1 },
    { ...lease, token: OwnerQuiescence.Token.make("other") },
  ]) strictEqual(OwnerQuiescence.control.commit(stale), false)
  strictEqual(OwnerQuiescence.status().committed, false)
  strictEqual(OwnerQuiescence.control.commit(lease), true)
  strictEqual(OwnerQuiescence.control.commit(lease), true)
  strictEqual(OwnerQuiescence.control.release(lease), false)
  throws(() => OwnerQuiescence.release(lease), OwnerQuiescence.Stale)
  lease[Symbol.dispose]()
  strictEqual(OwnerQuiescence.status().committed, true)
  strictEqual(OwnerQuiescence.status().sealed, true)
  throws(() => OwnerQuiescence.runPromise(async () => delivered.push(2)), OwnerQuiescence.Sealed)
  await Effect.runPromise(OwnerQuiescence.cleanup(Effect.promise(() => OwnerQuiescence.cleanupPromise(async () => {
    delivered.push(3)
    throws(() => OwnerQuiescence.runPromise(async () => delivered.push(4)), OwnerQuiescence.Sealed)
  }))))
  deepStrictEqual(delivered, [3])
  strictEqual(OwnerQuiescence.status().active, 0)
})

for (const scenario of scenarios) {
  await scenario.run()
  console.log(`PASS ${scenario.name}`)
}
