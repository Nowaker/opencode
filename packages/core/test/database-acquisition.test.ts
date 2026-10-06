import { expect } from "bun:test"
import { Cause, Clock, Deferred, Duration, Effect, Exit, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { LockTimeoutError, SqlError } from "effect/unstable/sql/SqlError"
import { Database } from "../src/database/database"
import { DatabaseTransaction } from "../src/database/transaction"
import { testEffect } from "./lib/effect"
import { transactionClient } from "./fixture/transaction-client"

const it = testEffect(Database.layerFromPath(":memory:"))
const busy = () => new SqlError({ reason: new LockTimeoutError({ cause: { code: "SQLITE_BUSY", errno: 5 } }) })

it.effect("caps retry delays and returns the last original error at the elapsed deadline", () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const errors: SqlError[] = []
    const waits: number[] = []
    const started: number[] = []
    const clock = yield* Clock.Clock
    const wrapped = yield* transactionClient(db, () =>
      Effect.gen(function* () {
        started.push(yield* Clock.currentTimeMillis)
        const error = busy()
        errors.push(error)
        return yield* Effect.fail(error)
      }),
    )
    const fiber = yield* DatabaseTransaction.immediate(wrapped, () => Effect.die("body must not run")).pipe(
      Effect.provideService(Clock.Clock, {
        ...clock,
        sleep: (duration) => {
          waits.push(Duration.toMillis(duration))
          return clock.sleep(duration)
        },
      }),
      Effect.forkScoped,
    )
    yield* TestClock.adjust(60_000)
    const exit = yield* Fiber.await(fiber)
    expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toBe(errors.at(-1))
    expect(waits.slice(0, 7)).toEqual([50, 100, 200, 400, 800, 1000, 1000])
    expect(Math.max(...waits)).toBe(1000)
    expect(waits.reduce((sum, wait) => sum + wait, 0)).toBe(60_000)
    expect(started.every((time) => time < 60_000)).toBe(true)
    expect(started).toHaveLength(waits.length)
  }),
)

it.effect("clamps the final sleep to the time left after acquisition", () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const error = busy()
    const began = yield* Deferred.make<void>()
    const finish = yield* Deferred.make<void>()
    const clock = yield* Clock.Clock
    const waits: number[] = []
    let attempts = 0
    const wrapped = yield* transactionClient(db, () =>
      Effect.gen(function* () {
        attempts++
        yield* Deferred.succeed(began, undefined)
        yield* Deferred.await(finish)
        return yield* Effect.fail(error)
      }),
    )
    const fiber = yield* DatabaseTransaction.immediate(wrapped, () => Effect.void).pipe(
      Effect.provideService(Clock.Clock, {
        ...clock,
        sleep: (duration) => {
          waits.push(Duration.toMillis(duration))
          return clock.sleep(duration)
        },
      }),
      Effect.forkScoped,
    )
    yield* Deferred.await(began)
    yield* TestClock.adjust(59_980)
    yield* Deferred.succeed(finish, undefined)
    yield* TestClock.adjust(20)
    const exit = yield* Fiber.await(fiber)
    expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toBe(error)
    expect(waits).toEqual([20])
    expect(attempts).toBe(1)
  }),
)

it.effect("counts native acquisition time toward the budget and starts no attempt at the deadline", () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const error = busy()
    const began = yield* Deferred.make<void>()
    const finish = yield* Deferred.make<void>()
    let attempts = 0
    const wrapped = yield* transactionClient(db, () =>
      Effect.gen(function* () {
        attempts++
        yield* Deferred.succeed(began, undefined)
        yield* Deferred.await(finish)
        return yield* Effect.fail(error)
      }),
    )
    const fiber = yield* DatabaseTransaction.immediate(wrapped, () => Effect.void).pipe(Effect.forkScoped)
    yield* Deferred.await(began)
    yield* TestClock.adjust(60_000)
    yield* Deferred.succeed(finish, undefined)
    const exit = yield* Fiber.await(fiber)
    expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toBe(error)
    expect(attempts).toBe(1)
  }),
)

it.effect("allocates entry and deadline state per execution of the same effect", () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    let begins = 0
    let calls = 0
    const wrapped = yield* transactionClient(db, (statement) => {
      if (statement !== "begin immediate") return Effect.void
      begins++
      return begins === 2 ? Effect.fail(busy()) : Effect.void
    })
    const operation = DatabaseTransaction.immediate(wrapped, () => Effect.sync(() => ++calls))
    const result = yield* Effect.gen(function* () {
      return [yield* operation, yield* operation]
    }).pipe(Effect.forkScoped)
    yield* TestClock.adjust(50)
    expect(yield* Fiber.join(result)).toEqual([1, 2])
    expect(begins).toBe(3)
  }),
)
