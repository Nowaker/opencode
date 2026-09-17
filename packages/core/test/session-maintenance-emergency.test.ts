import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { Cause, Effect } from "effect"
import { sql } from "drizzle-orm"
import { Service, layerFromPath } from "../src/database/database"
import { tmpdir } from "./fixture/tmpdir"

test("emergency sentinel removes only expensive guards and keeps replacement fail-closed across reconnects", async () => {
  // Given an existing database with the full conflict guards installed.
  await using tmp = await tmpdir()
  const filename = `${tmp.path}/maintenance.db`
  await Effect.runPromise(Effect.gen(function* () { yield* Service }).pipe(Effect.provide(layerFromPath(filename)), Effect.scoped))
  using before = new Database(filename)
  const guards = before.query<{ name: string; sql: string }, []>("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name GLOB 'session_conflict_*'").all()
  expect(guards.length).toBeGreaterThan(0)
  await Bun.write(`${filename}.conflict-guards-disabled`, "Emergency incident mitigation; replacement is prohibited.\n")

  // When two successive real runtime connections see the emergency sentinel.
  for (const attempt of [1, 2]) {
    await Effect.runPromise(Effect.gen(function* () {
      const { db } = yield* Service
      // Then the runtime refuses protocol-2 maintenance and installs no costly TEMP guards.
      expect(yield* db.get(sql`SELECT protocol FROM session_maintenance_runtime`)).toEqual({ protocol: 0 })
      expect(yield* db.all(sql`SELECT name FROM sqlite_temp_master WHERE type='trigger' AND name GLOB 'session_generation_conflict_*'`)).toEqual([])
      const inert = yield* db.all<{ sql: string }>(sql`SELECT sql FROM sqlite_master WHERE type='trigger' AND name GLOB 'session_conflict_*'`)
      expect(inert.length).toBe(guards.length)
      expect(inert.every(row => row.sql.endsWith("WHEN 0 BEGIN SELECT 1; END"))).toBe(true)
      // An old installer's IF NOT EXISTS cannot replace the same-name placeholders.
      for (const guard of guards) before.exec(guard.sql.replace("CREATE TRIGGER", "CREATE TRIGGER IF NOT EXISTS"))
      yield* db.run(sql`INSERT INTO session_maintenance_fence VALUES('ses_fenced','operation','replace')`)
      const fenced = yield* db.run(sql`INSERT INTO event_sequence(aggregate_id,seq) VALUES('ses_fenced',0)`).pipe(Effect.exit)
      expect(fenced._tag).toBe("Failure")
      if (fenced._tag === "Failure") expect(Cause.pretty(fenced.cause)).toContain("session_under_maintenance")
      yield* db.run(sql`DELETE FROM session_maintenance_fence`)
      yield* db.run(sql`INSERT OR REPLACE INTO session_maintenance_generation VALUES('ses_stale',${attempt})`)
      const stale = yield* db.run(sql`INSERT INTO event_sequence(aggregate_id,seq) VALUES('ses_stale',0)`).pipe(Effect.exit)
      expect(stale._tag).toBe("Failure")
      if (stale._tag === "Failure") expect(Cause.pretty(stale.cause)).toContain("session_identity_changed")
      yield* db.run(sql`INSERT OR REPLACE INTO event_sequence(aggregate_id,seq) VALUES('ses_unrelated',${attempt})`)
    }).pipe(Effect.provide(layerFromPath(filename)), Effect.scoped))
  }
})

test("emergency activation refuses an already active replacement without changing persistent guards", async () => {
  await using tmp = await tmpdir()
  const filename = `${tmp.path}/maintenance.db`
  await Effect.runPromise(Effect.gen(function* () { yield* Service }).pipe(Effect.provide(layerFromPath(filename)), Effect.scoped))
  using before = new Database(filename)
  before.exec("INSERT INTO session_maintenance_fence VALUES('ses_fenced','operation','replace')")
  const guards = before.query("SELECT sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all()
  await Bun.write(`${filename}.conflict-guards-disabled`, "Emergency\n")
  const result = await Effect.runPromiseExit(Effect.gen(function* () { yield* Service }).pipe(Effect.provide(layerFromPath(filename)), Effect.scoped))
  expect(result._tag).toBe("Failure")
  if (result._tag === "Failure") expect(Cause.pretty(result.cause)).toContain("cannot disable conflict guards during active maintenance")
  expect(before.query("SELECT sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all()).toEqual(guards)
})
