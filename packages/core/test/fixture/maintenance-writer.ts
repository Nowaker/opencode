import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { Database } from "../../src/database/database"
import { SessionMaintenance } from "../../src/database/session-maintenance"

const filename = process.argv[2]
if (!filename) throw new Error("database argument required")
await Effect.runPromise(
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    process.stdout.write("ready\n")
    yield* Effect.promise(() => Bun.stdin.text())
    const admission = yield* SessionMaintenance.assertCurrent(db, "ses_replaced").pipe(Effect.exit)
    const changed = yield* db
      .run(sql`INSERT INTO event_sequence(aggregate_id,seq) VALUES('ses_replaced',0)`)
      .pipe(Effect.exit)
    const other = yield* db
      .run(
        sql`INSERT INTO event_sequence(aggregate_id,seq) VALUES('ses_unrelated',0) ON CONFLICT(aggregate_id) DO UPDATE SET seq=seq+1`,
      )
      .pipe(Effect.exit)
    process.stdout.write(JSON.stringify({ admission: admission._tag, changed: changed._tag, other: other._tag }))
  }).pipe(Effect.provide(Database.layerFromPath(filename)), Effect.scoped),
)
