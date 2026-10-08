export * as DatabaseTransaction from "./transaction"

import { Cause, Clock, Effect, Exit, Option } from "effect"
import { isSqlError, type SqlError } from "effect/unstable/sql/SqlError"
import type { Database } from "./database"
import { SqliteFailure } from "./sqlite-error"
import { TransactionDiagnostic } from "./transaction-diagnostic"

export function immediate<A, E, R, E2 = never, R2 = never>(
  db: Database.Interface["db"],
  body: () => Effect.Effect<A, E, R>,
  afterCommit?: (value: A) => Effect.Effect<void, E2, R2>,
): Effect.Effect<A, E | E2 | SqlError, R | R2> {
  return Effect.suspend(() =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const nested = Option.isSome(yield* Effect.serviceOption(db.$client.transactionService))
        const started = yield* Clock.currentTimeMillis
        let attempts = 0
        let phase: TransactionDiagnostic.Details["phase"] = "acquire"
        let bodyOutcome: TransactionDiagnostic.Details["bodyOutcome"]
        const bodyErrors = new Set<SqlError>()
        function errors(cause: Cause.Cause<unknown>) {
          return cause.reasons.flatMap((reason) => {
            switch (reason._tag) {
              case "Fail": {
                const failure = SqliteFailure.unwrap(reason.error)
                return failure ? [failure] : []
              }
              case "Die": {
                const failure = SqliteFailure.unwrap(reason.defect)
                return failure ? [failure] : []
              }
              case "Interrupt":
                return []
            }
          })
        }
        function acquire(last?: SqlError, delay = 50): Effect.Effect<A, E | SqlError, R> {
          return Effect.gen(function* () {
            yield* restore(Effect.void)
            if (last && (yield* Clock.currentTimeMillis) - started >= 60_000) return yield* Effect.fail(last)
            let entered = false
            attempts++
            return yield* db
              .transaction(
                () =>
                  Effect.gen(function* () {
                    // Mark entry before constructing user work: neither thrown construction nor commit can be retried.
                    yield* Effect.sync(() => {
                      entered = true
                    })
                    return yield* Effect.suspend(body).pipe(
                      Effect.onExit((exit) =>
                        Effect.sync(() => {
                          bodyOutcome = Exit.isSuccess(exit) ? "success" : "failure"
                          if (Exit.isFailure(exit)) {
                            for (const error of errors(exit.cause)) bodyErrors.add(error)
                          }
                          phase = "finalize"
                        }),
                      ),
                    )
                  }),
                { behavior: "immediate" },
              )
              .pipe(
                Effect.catch((error) => {
                  if (entered || nested || !isSqlError(error) || !SqliteFailure.parse(error)?.retryAcquisition)
                    return Effect.fail(error)
                  return Effect.gen(function* () {
                    const remaining = 60_000 - ((yield* Clock.currentTimeMillis) - started)
                    if (remaining <= 0) return yield* Effect.fail(error)
                    yield* restore(Effect.sleep(Math.min(delay, remaining)))
                    return yield* acquire(error, Math.min(delay * 2, 1000))
                  })
                }),
              )
          })
        }
        return yield* Effect.gen(function* () {
          const value = yield* acquire()
          if (afterCommit) {
            phase = "after_commit"
            yield* Effect.suspend(() => afterCommit(value))
          }
          return value
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              const elapsedMs = (yield* Clock.currentTimeMillis) - started
              for (const error of errors(cause)) {
                const origin = bodyErrors.has(error) ? "body" : phase
                TransactionDiagnostic.record(error, {
                  phase: origin,
                  ...(origin === "finalize" && bodyOutcome ? { bodyOutcome } : {}),
                  nested,
                  attempts,
                  elapsedMs,
                })
              }
              return yield* Effect.failCause(cause)
            }),
          ),
        )
      }),
    ),
  )
}
