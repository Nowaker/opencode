import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { Service, layerFromPath } from "../src/database/database"
import { SessionMaintenanceTrigger } from "../src/database/session-maintenance-trigger"
import { tmpdir } from "./fixture/tmpdir"
import { rmSync } from "node:fs"

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

test("disabled sentinel preserves protocol zero until explicit isolated activation restores indexed guards", async () => {
  // Given an isolated database with the emergency marker in place before startup.
  await using tmp = await tmpdir()
  const path = `${tmp.path}/disabled.db`
  await Bun.write(`${path}.conflict-guards-disabled`, "fixture")
  await Effect.runPromise(Effect.gen(function* () {
    const { db } = yield* Service
    expect(yield* db.get(sql`SELECT protocol FROM session_maintenance_runtime`)).toEqual({ protocol: 0 })
    expect(yield* db.all(sql`SELECT name FROM sqlite_temp_master WHERE name LIKE 'session_generation_conflict_%'`)).toEqual([])
  }).pipe(Effect.provide(layerFromPath(path)), Effect.scoped))
  // When the fixture's coordinator explicitly removes its own marker and opens a new connection.
  rmSync(`${path}.conflict-guards-disabled`)
  await connect(path)
  // Then that connection migrates inert guards to protocol 3 canonical SQL.
  using db = new Database(path)
  expect(db.query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE type='trigger' AND name GLOB 'session_conflict_*'").all()
    .every(row => row.sql.includes("AND EXISTS") && !row.sql.includes("WHEN 0"))).toBe(true)
})

test("partial unique indexes refuse installation rather than introduce an unbounded conflict lookup", async () => {
  // Given an added partial unique constraint not covered by the indexed-key protocol.
  await using tmp = await tmpdir()
  const path = `${tmp.path}/partial.db`
  await connect(path)
  using db = new Database(path)
  db.exec("CREATE UNIQUE INDEX partial_part ON part(message_id) WHERE session_id='special'")
  // When a new runtime discovers that constraint.
  const result = await Effect.runPromiseExit(Effect.gen(function* () { yield* Service }).pipe(Effect.provide(layerFromPath(path)), Effect.scoped))
  // Then capability publication fails instead of installing a scanning predicate.
  expect(result._tag).toBe("Failure")
})
