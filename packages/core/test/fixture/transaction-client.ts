import { Effect } from "effect"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import type { Connection } from "effect/unstable/sql/SqlConnection"
import type { SqlError } from "effect/unstable/sql/SqlError"
import type { Database } from "../../src/database/database"

export function transactionClient(
  db: Database.Interface["db"],
  before: (statement: string) => Effect.Effect<void, SqlError>,
) {
  const reserve = db.$client.reserve.pipe(
    Effect.map((connection) => ({
      ...connection,
      executeUnprepared: (...args: Parameters<Connection["executeUnprepared"]>) =>
        Effect.suspend(() => before(args[0])).pipe(
          Effect.andThen(Effect.suspend(() => connection.executeUnprepared(...args))),
        ),
    })),
  )
  const client = new Proxy(db.$client, {
    get(target, property, receiver) {
      if (property === "reserve") return reserve
      return Reflect.get(target, property, receiver)
    },
  })
  return EffectDrizzleSqlite.makeWithDefaults().pipe(Effect.provideService(SqlClient, client))
}
