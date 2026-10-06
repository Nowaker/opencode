import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Effect, Stream } from "effect"
import { Reactivity } from "effect/unstable/reactivity"
import { SqlClient, make } from "effect/unstable/sql/SqlClient"
import type { Connection } from "effect/unstable/sql/SqlConnection"
import { makeCompilerSqlite } from "effect/unstable/sql/Statement"

export type Observer = (query: string, phase: "before" | "after") => Promise<void>

export function connection(filename: string, observe: Observer) {
  return Effect.gen(function* () {
    const actual = yield* SqliteClient.make({ filename })
    const reserved = yield* actual.reserve
    const forward = <A, E, R>(query: string, effect: Effect.Effect<A, E, R>) =>
      Effect.promise(() => observe(query, "before")).pipe(
        Effect.andThen(effect),
        Effect.tap(() => Effect.promise(() => observe(query, "after"))),
      )
    const forwarding: Connection = {
      execute: (query, params, transform) => forward(query, reserved.execute(query, params, transform)),
      executeRaw: (query, params) => forward(query, reserved.executeRaw(query, params)),
      executeValues: (query, params) => forward(query, reserved.executeValues(query, params)),
      executeUnprepared: (query, params, transform) => forward(query, reserved.executeUnprepared(query, params, transform)),
      executeStream: (query, params, transform) => Stream.unwrap(forward(query, Effect.succeed(reserved.executeStream(query, params, transform)))),
    }
    const client = yield* make({
      acquirer: Effect.succeed(forwarding),
      compiler: makeCompilerSqlite(),
      transactionService: actual.transactionService,
      spanAttributes: [],
    })
    return yield* EffectDrizzleSqlite.makeWithDefaults().pipe(Effect.provideService(SqlClient, client))
  }).pipe(Effect.provide(Reactivity.layer))
}
