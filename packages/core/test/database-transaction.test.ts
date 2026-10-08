import { expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber } from "effect"
import { classifySqliteError, LockTimeoutError, SqlError } from "effect/unstable/sql/SqlError"
import { Database } from "../src/database/database"
import { DatabaseTransaction } from "../src/database/transaction"
import { TransactionDiagnostic } from "../src/database/transaction-diagnostic"
import { testEffect } from "./lib/effect"
import { transactionClient } from "./fixture/transaction-client"

const it = testEffect(Database.layerFromPath(":memory:"))
const busy = () => new SqlError({ reason: new LockTimeoutError({ cause: { code: "SQLITE_BUSY", errno: 5 } }) })

for (const stage of ["construction", "body", "defect", "commit", "rollback", "postcommit"] as const) {
  it.effect(`never replays entered work after ${stage} failure`, () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const error = busy()
      const statements: string[] = []
      const wrapped = yield* transactionClient(db, (statement) =>
        Effect.sync(() => {
          statements.push(statement)
        }).pipe(
          Effect.andThen(
            (statement === "commit" && stage === "commit") || (statement === "rollback" && stage === "rollback")
              ? Effect.fail(error)
              : Effect.void,
          ),
        ),
      )
      let calls = 0
      let wakes = 0
      const exit = yield* DatabaseTransaction.immediate(
        wrapped,
        () => {
          calls++
          if (stage === "construction") throw error
          if (stage === "body" || stage === "rollback") return Effect.fail(error)
          if (stage === "defect") return Effect.die(error)
          return Effect.succeed("committed")
        },
        () =>
          Effect.sync(() => {
            wakes++
          }).pipe(Effect.andThen(stage === "postcommit" ? Effect.fail(error) : Effect.void)),
      ).pipe(Effect.exit)
      expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toBe(error)
      expect(TransactionDiagnostic.get(error)).toMatchObject({
        phase: stage === "commit" ? "finalize" : stage === "postcommit" ? "after_commit" : "body",
        ...(stage === "commit" ? { bodyOutcome: "success" } : {}),
        nested: false,
        attempts: 1,
        reason: "LockTimeoutError",
        nativeCode: "SQLITE_BUSY",
        pid: process.pid,
      })
      expect(calls).toBe(1)
      expect(wakes).toBe(stage === "postcommit" ? 1 : 0)
      expect(statements.filter((statement) => statement === "begin immediate")).toHaveLength(1)
      expect(statements).toEqual(
        stage === "postcommit"
          ? ["begin immediate", "commit"]
          : stage === "commit"
            ? ["begin immediate", "commit", "rollback"]
            : ["begin immediate", "rollback"],
      )
    }),
  )
}

it.effect("preserves COMMIT failure even when cleanup rollback fails", () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const error = busy()
    const cleanup = busy()
    let calls = 0
    const wrapped = yield* transactionClient(db, (statement) =>
      statement === "commit" ? Effect.fail(error) : statement === "rollback" ? Effect.fail(cleanup) : Effect.void,
    )
    const exit = yield* DatabaseTransaction.immediate(wrapped, () =>
      Effect.sync(() => {
        calls++
      }),
    ).pipe(Effect.exit)
    expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toBe(error)
    expect(calls).toBe(1)
  }),
)

it.effect("does not retry acquisition of a nested savepoint", () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const error = busy()
    const statements: string[] = []
    let calls = 0
    const wrapped = yield* transactionClient(db, (statement) => {
      statements.push(statement)
      return statement.startsWith("savepoint") ? Effect.fail(error) : Effect.void
    })
    const exit = yield* wrapped
      .transaction(() =>
        DatabaseTransaction.immediate(wrapped, () =>
          Effect.sync(() => {
            calls++
          }),
        ),
      )
      .pipe(Effect.exit)
    expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toBe(error)
    expect(calls).toBe(0)
    expect(statements).toEqual(["begin deferred", "savepoint effect_sql_1", "rollback"])
  }),
)

for (const code of [
  "SQLITE_LOCKED",
  "SQLITE_BUSY_SNAPSHOT",
  "SQLITE_BUSY_OTHER",
  "SQLITE_CONSTRAINT",
  "SQLITE_INTERRUPT",
  "session_under_maintenance",
  1811,
  undefined,
]) {
  it.effect(`does not retry unsafe acquisition code ${code}`, () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const error = new SqlError({ reason: classifySqliteError({ code }) })
      let attempts = 0
      let calls = 0
      const wrapped = yield* transactionClient(db, () => {
        attempts++
        return Effect.fail(error)
      })
      const exit = yield* DatabaseTransaction.immediate(wrapped, () =>
        Effect.sync(() => {
          calls++
        }),
      ).pipe(Effect.exit)
      expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toBe(error)
      expect(attempts).toBe(1)
      expect(calls).toBe(0)
      expect(TransactionDiagnostic.get(error)).toMatchObject({ phase: "acquire", attempts: 1, nested: false })
    }),
  )
}

it.effect("protects entered work, COMMIT and afterCommit from a pending interruption", () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const entered = yield* Deferred.make<void>()
    const finish = yield* Deferred.make<void>()
    const waking = yield* Deferred.make<void>()
    const notified = yield* Deferred.make<void>()
    const statements: string[] = []
    let calls = 0
    let wakes = 0
    const wrapped = yield* transactionClient(db, (statement) =>
      Effect.sync(() => {
        statements.push(statement)
      }),
    )
    const worker = yield* DatabaseTransaction.immediate(
      wrapped,
      () =>
        Effect.gen(function* () {
          calls++
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(finish)
        }),
      () =>
        Effect.gen(function* () {
          wakes++
          yield* Deferred.succeed(waking, undefined)
          yield* Deferred.await(notified)
        }),
    ).pipe(Effect.forkScoped)
    yield* Deferred.await(entered)
    const cancelling = yield* Fiber.interrupt(worker).pipe(Effect.forkScoped)
    yield* Effect.yieldNow
    expect(worker.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(finish, undefined)
    yield* Deferred.await(waking)
    expect(statements).toEqual(["begin immediate", "commit"])
    expect(worker.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(notified, undefined)
    yield* Fiber.join(cancelling)
    expect(calls).toBe(1)
    expect(wakes).toBe(1)
  }),
)

it.effect("propagates an interruption without interpreting it as acquisition contention", () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    let attempts = 0
    let calls = 0
    const wrapped = yield* transactionClient(db, () => {
      attempts++
      return Effect.interrupt
    })
    const exit = yield* DatabaseTransaction.immediate(wrapped, () =>
      Effect.sync(() => {
        calls++
      }),
    ).pipe(Effect.exit)
    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
    expect(attempts).toBe(1)
    expect(calls).toBe(0)
  }),
)
