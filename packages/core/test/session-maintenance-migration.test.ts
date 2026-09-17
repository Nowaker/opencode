import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { Service, layerFromPath } from "../src/database/database"
import { SessionMaintenanceTrigger } from "../src/database/session-maintenance-trigger"
import { tmpdir } from "./fixture/tmpdir"

async function connect(path: string) {
  await Effect.runPromise(Effect.gen(function* () {
    const { db } = yield* Service
    expect(yield* db.get(sql`SELECT protocol FROM session_maintenance_runtime`)).toEqual({ protocol: 3 })
  }).pipe(Effect.provide(layerFromPath(path)), Effect.scoped))
}

for (const obsolete of [
  "CREATE TRIGGER session_conflict_part_INSERT BEFORE INSERT ON part WHEN 0 BEGIN SELECT 1; END",
  "CREATE TRIGGER session_conflict_part_INSERT BEFORE INSERT ON part WHEN EXISTS(SELECT 1 FROM part existing, session_maintenance_fence blocked WHERE ((existing.rowid COLLATE BINARY=NEW.rowid) OR (existing.id COLLATE BINARY=NEW.id)) AND blocked.session_id IN(existing.session_id)) BEGIN SELECT RAISE(ABORT,'session_under_maintenance'); END",
]) test("a new runtime replaces obsolete guards atomically once without recreating canonical guards", async () => {
  // Given a database initialized by the current runtime and then quarantined with an inert same-name guard.
  await using tmp = await tmpdir()
  const path = `${tmp.path}/migration.db`
  await connect(path)
  using db = new Database(path)
  db.exec(`DROP TRIGGER session_conflict_part_INSERT; ${obsolete}`)
  const oldVersion = db.query<{ schema_version: number }, []>("PRAGMA schema_version").get()?.schema_version
  // When a newly opened runtime installs the new canonical definition.
  await connect(path)
  const fixed = db.query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE name='session_conflict_part_INSERT'").get()?.sql
  expect(fixed).toContain("SELECT 1 FROM")
  expect(fixed).not.toContain("WHEN 0")
  const fixedVersion = db.query<{ schema_version: number }, []>("PRAGMA schema_version").get()?.schema_version
  expect(fixedVersion).toBeGreaterThan(oldVersion ?? 0)
  // Then another connection does not churn the installed schema.
  await connect(path)
  expect(db.query("PRAGMA schema_version").get()).toEqual({ schema_version: fixedVersion })
})

test("failed trigger migration restores the original installed guard", async () => {
  // Given an existing guard and a transaction containing an invalid replacement.
  await Effect.runPromise(Effect.gen(function* () {
    const { db } = yield* Service
    const previous = yield* db.get(sql`SELECT sql FROM sqlite_master WHERE name='session_conflict_part_INSERT'`)
    // When the replacement fails after removing the old definition inside the transaction.
    const result = yield* db.transaction(() => SessionMaintenanceTrigger.install(db,
      'CREATE TRIGGER "session_conflict_part_INSERT" BEFORE INSERT ON nonexistent_table BEGIN SELECT 1; END',
    ), { behavior: "immediate" }).pipe(Effect.exit)
    // Then rollback leaves the prior guard in place.
    expect(result._tag).toBe("Failure")
    expect(yield* db.get(sql`SELECT sql FROM sqlite_master WHERE name='session_conflict_part_INSERT'`)).toEqual(previous)
  }).pipe(Effect.provide(layerFromPath(":memory:")), Effect.scoped))
})
