export * as DatabaseTransaction from "./transaction"

import { Clock, Effect, Option } from "effect"
import { isSqlError, type SqlError } from "effect/unstable/sql/SqlError"
import type { Database } from "./database"
import { SqliteFailure } from "./sqlite-error"

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
        function acquire(last?: SqlError, delay = 50): Effect.Effect<A, E | SqlError, R> {
          return Effect.gen(function* () {
            yield* restore(Effect.void)
            if (last && (yield* Clock.currentTimeMillis) - started >= 60_000) return yield* Effect.fail(last)
            let entered = false
            return yield* db
              .transaction(
                () =>
                  Effect.gen(function* () {
                    // Mark entry before constructing user work: neither thrown construction nor commit can be retried.
                    yield* Effect.sync(() => {
                      entered = true
                    })
                    return yield* Effect.suspend(body)
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
        const value = yield* acquire()
        if (afterCommit) yield* Effect.suspend(() => afterCommit(value))
        return value
      }),
    ),
  )
}
