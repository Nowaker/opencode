import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { Service, layerFromPath } from "../src/database/database"
import { SessionMaintenance } from "../src/database/session-maintenance"
import { tmpdir } from "./fixture/tmpdir"

test("real runtime connection refuses stale admissions and direct writes after a generation advance", async () => {
  // Given a migrated runtime database with registered generation protection.
  await using tmp = await tmpdir()
  const filename = `${tmp.path}/maintenance.db`
  await Effect.runPromise(
    Effect.gen(function* () {
      const { db } = yield* Service
      expect(yield* db.get(sql`SELECT protocol FROM session_maintenance_runtime`)).toEqual({ protocol: 1 })
      using maintenance = new Database(filename)
      maintenance.exec("INSERT INTO session_maintenance_generation VALUES('ses_replaced',1)")
      // When the same runtime tries to resume the replaced identity.
      const admission = yield* SessionMaintenance.assertCurrent(db, "ses_replaced").pipe(Effect.exit)
      // Then stale admission fails while unrelated admission still succeeds.
      expect(admission._tag).toBe("Failure")
      yield* SessionMaintenance.assertCurrent(db, "ses_unrelated")
      const write = yield* db
        .run(sql`INSERT INTO event_sequence(aggregate_id,seq) VALUES('ses_replaced',0)`)
        .pipe(Effect.exit)
      expect(write._tag).toBe("Failure")
      yield* db.run(sql`INSERT INTO event_sequence(aggregate_id,seq) VALUES('ses_unrelated',0)`)
    }).pipe(Effect.provide(layerFromPath(filename)), Effect.scoped),
  )
  // Given the same process opens another connection, cached state must not become fresh.
  await Effect.runPromise(
    Effect.gen(function* () {
      const { db } = yield* Service
      const admission = yield* SessionMaintenance.assertCurrent(db, "ses_replaced").pipe(Effect.exit)
      expect(admission._tag).toBe("Failure")
    }).pipe(Effect.provide(layerFromPath(filename)), Effect.scoped),
  )
})
