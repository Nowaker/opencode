import { expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { LockTimeoutError, SqlError } from "effect/unstable/sql/SqlError"
import { Session } from "@opencode-ai/schema/session"
import { SessionV1 } from "@opencode-ai/schema/session-v1"
import { Database } from "../src/database/database"
import { DatabaseTransaction } from "../src/database/transaction"
import { TransactionDiagnostic } from "../src/database/transaction-diagnostic"
import { EventV2 } from "../src/event"
import { transactionClient } from "./fixture/transaction-client"
import { testEffect } from "./lib/effect"

const it = testEffect(EventV2.layerWith().pipe(Layer.provideMerge(Database.layerFromPath(":memory:"))))
const busy = () => new SqlError({ reason: new LockTimeoutError({ cause: { code: "SQLITE_BUSY", errno: 5 } }) })

it.effect("attributes a replacement rollback error to finalization rather than the body", () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const body = busy()
    const rollback = busy()
    const wrapped = yield* transactionClient(db, (statement) =>
      statement === "rollback" ? Effect.fail(rollback) : Effect.void,
    )
    const exit = yield* DatabaseTransaction.immediate(wrapped, () => Effect.fail(body)).pipe(Effect.exit)
    expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toBe(rollback)
    expect(TransactionDiagnostic.get(rollback)).toMatchObject({ phase: "finalize", bodyOutcome: "failure" })
    expect(TransactionDiagnostic.get(body)).toBeUndefined()
  }),
)

it.effect("preserves the commit origin when cleanup fails with a distinct error", () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const commit = busy()
    const cleanup = busy()
    const wrapped = yield* transactionClient(db, (statement) =>
      statement === "commit" ? Effect.fail(commit) : statement === "rollback" ? Effect.fail(cleanup) : Effect.void,
    )
    const exit = yield* DatabaseTransaction.immediate(wrapped, () => Effect.void).pipe(Effect.exit)
    expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toBe(commit)
    expect(TransactionDiagnostic.get(commit)).toMatchObject({ phase: "finalize", bodyOutcome: "success" })
    expect(TransactionDiagnostic.get(cleanup)).toBeUndefined()
  }),
)

it.effect("retains inner acquisition origin through the outer body's failure", () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const error = busy()
    const wrapped = yield* transactionClient(db, (statement) =>
      statement.startsWith("savepoint") ? Effect.fail(error) : Effect.void,
    )
    const exit = yield* DatabaseTransaction.immediate(wrapped, () =>
      DatabaseTransaction.immediate(wrapped, () => Effect.void),
    ).pipe(Effect.exit)
    expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toBe(error)
    expect(TransactionDiagnostic.get(error)).toMatchObject({ phase: "acquire", nested: true, attempts: 1 })
  }),
)

it.effect("retains SQL diagnostics through actual durable event defect conversion", () =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const error = busy()
    yield* events.project(SessionV1.Event.MessageRemoved, () => Effect.die(error))
    const exit = yield* events
      .publish(SessionV1.Event.MessageRemoved, {
        sessionID: Session.ID.make("ses_diagnostic"),
        messageID: SessionV1.MessageID.ascending("msg_diagnostic"),
      })
      .pipe(Effect.exit)
    expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toBe(error)
    expect(Exit.isFailure(exit) && exit.cause.reasons.every(Cause.isDieReason)).toBe(true)
    expect(TransactionDiagnostic.get(error)).toMatchObject({ phase: "body", nested: false, attempts: 1 })
  }),
)

it.effect("does not diagnose a non-SQL failure or reinterpret its cause", () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const error = new Error("ordinary failure")
    const exit = yield* DatabaseTransaction.immediate(db, () => Effect.die(error)).pipe(Effect.exit)
    expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toBe(error)
    expect(TransactionDiagnostic.get(error)).toBeUndefined()
  }),
)

it.effect("diagnoses a real statement error wrapped by the Drizzle adapter", () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    yield* db.run("CREATE TABLE diagnostic_fixture (id INTEGER UNIQUE)")
    yield* db.run("INSERT INTO diagnostic_fixture VALUES (1)")
    const exit = yield* DatabaseTransaction.immediate(db, () =>
      db.run("INSERT INTO diagnostic_fixture VALUES (1)"),
    ).pipe(Effect.orDie, Effect.exit)
    const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
    expect(TransactionDiagnostic.get(error)).toMatchObject({
      phase: "body",
      attempts: 1,
      nativeCode: "SQLITE_CONSTRAINT_UNIQUE",
    })
  }),
)

it.effect("does not publish metadata for a busy error recovered before entry", () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const error = busy()
    let attempts = 0
    const wrapped = yield* transactionClient(db, () => (++attempts === 1 ? Effect.fail(error) : Effect.void))
    const value = yield* DatabaseTransaction.immediate(wrapped, () => Effect.succeed("committed")).pipe(
      Effect.forkScoped,
    )
    yield* TestClock.adjust(50)
    expect(yield* Fiber.join(value)).toBe("committed")
    expect(TransactionDiagnostic.get(error)).toBeUndefined()
  }),
)
