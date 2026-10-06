import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { SessionMaintenance } from "../src/database/session-maintenance"
import { SessionMaintenanceSql } from "../src/database/session-maintenance-sql"
import { connection } from "./fixture/maintenance-startup"
import type { Observer } from "./fixture/maintenance-startup"
import { child } from "./fixture/maintenance-startup-child"

async function fixture() {
  await mkdir(`${import.meta.dir}/../../../tmp`, { recursive: true })
  const path = await mkdtemp(`${import.meta.dir}/../../../tmp/maintenance-startup-`)
  const filename = `${path}/startup.db`
  using native = new Database(filename)
  native.exec("PRAGMA journal_mode=WAL; CREATE TABLE part(id TEXT PRIMARY KEY,session_id TEXT,data TEXT)")
  return { filename, async [Symbol.asyncDispose]() { await rm(path, { recursive: true, force: true }) } }
}

function install(filename: string, observe: Observer) {
  return Effect.runPromise(Effect.gen(function* () {
    const db = yield* connection(filename, observe)
    yield* SessionMaintenance.install(db)
  }).pipe(Effect.scoped))
}

test("initialized reconnect discovers schema and stages TEMP guards outside registration writer", async () => {
  await using tmp = await fixture()
  await install(tmp.filename, async () => {})
  const queries: string[] = []
  await install(tmp.filename, async (query, phase) => { if (phase === "before") queries.push(query.trim()) })
  const start = queries.findIndex(query => /^begin immediate$/i.test(query))
  const end = queries.findIndex((query, index) => index > start && /^commit$/i.test(query))
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  const registration = queries.slice(start + 1, end)
  const discovery = /sqlite_master|sqlite_schema|pragma_(table|index)|PRAGMA\s+(main\.)?(table|index)/i
  const ddl = /^(CREATE|DROP|ALTER)\b/i
  console.info("startup registration SQL:", registration)
  expect(registration.filter(query => discovery.test(query) || ddl.test(query))).toEqual([])
  const origin = registration.findIndex(query => /INSERT.*session_maintenance_origin/i.test(query))
  const snapshot = registration.findIndex(query => /INSERT.*session_maintenance_snapshot/i.test(query))
  const capability = registration.findIndex(query => /INSERT.*session_maintenance_runtime/i.test(query))
  expect(origin).toBeGreaterThanOrEqual(0)
  expect(snapshot).toBeGreaterThan(origin)
  expect(capability).toBe(registration.length - 1)
  expect(capability).toBeGreaterThan(snapshot)
  expect(queries.slice(0, start).some(query => /^CREATE TEMP TABLE.*session_maintenance_snapshot/i.test(query))).toBe(true)
})

test("schema change after read snapshot replans guards before publishing capability", async () => {
  await using tmp = await fixture()
  await install(tmp.filename, async () => {})
  await using writer = child(tmp.filename, "schema", "ALTER TABLE part ADD COLUMN aggregate_id TEXT; CREATE UNIQUE INDEX part_data ON part(data)")
  expect(await writer.next()).toBe("ready")
  const state = { changed: false }
  const queries: string[] = []
  await Effect.runPromise(Effect.gen(function* () {
    const db = yield* connection(tmp.filename, async (query, phase) => {
      if (phase === "before") queries.push(query.trim())
      if (phase !== "after" || !/^commit$/i.test(query.trim()) || state.changed) return
      state.changed = true
      writer.send("change")
      expect(await writer.next()).toBe("changed")
      expect(await writer.process.exited).toBe(0)
      using inspect = new Database(tmp.filename)
      expect(inspect.query("SELECT * FROM session_maintenance_runtime").all()).toEqual([])
    })
    yield* SessionMaintenance.install(db)
    expect(queries.filter(query => /^rollback$/i.test(query))).toHaveLength(1)
    expect(queries.filter(query => /INSERT INTO session_maintenance_runtime/i.test(query))).toHaveLength(1)
    yield* db.run(sql`INSERT INTO part VALUES('protected','owner','unique','aggregate')`)
    yield* db.run(sql`INSERT INTO session_maintenance_fence VALUES('owner','active','replacement')`)
    const replaced = yield* db.run(sql`INSERT OR REPLACE INTO part VALUES('new','other','unique','other')`).pipe(Effect.exit)
    expect(replaced._tag).toBe("Failure")
    yield* db.run(sql`INSERT INTO session_maintenance_fence VALUES('aggregate','active','replacement')`)
    const target = yield* db.run(sql`INSERT INTO part VALUES('target','other','second','aggregate')`).pipe(Effect.exit)
    expect(target._tag).toBe("Failure")
    yield* db.run(sql`DELETE FROM session_maintenance_fence`)
    yield* db.run(sql`INSERT INTO session_maintenance_generation VALUES('owner',1),('aggregate',1)`)
    const staleReplace = yield* db.run(sql`INSERT OR REPLACE INTO part VALUES('new','other','unique','other')`).pipe(Effect.exit)
    expect(staleReplace._tag).toBe("Failure")
    const staleTarget = yield* db.run(sql`INSERT INTO part VALUES('target','other','second','aggregate')`).pipe(Effect.exit)
    expect(staleTarget._tag).toBe("Failure")
    const runtime = yield* db.get<{ protocol: number }>(sql`SELECT protocol FROM session_maintenance_runtime`)
    expect(runtime?.protocol).toBe(3)
  }).pipe(Effect.scoped))
}, 20_000)

test("two installer processes observe drift then converge without exposing persistent guard gaps", async () => {
  await using tmp = await fixture()
  await install(tmp.filename, async () => {})
  using db = new Database(tmp.filename)
  db.exec("INSERT INTO part VALUES('protected','owner','unique'); INSERT INTO session_maintenance_fence VALUES('owner','active','replacement'); CREATE UNIQUE INDEX part_data ON part(data)")
  const before = db.query<{ schema_version: number }, []>("PRAGMA main.schema_version").get()
  await using first = child(tmp.filename, "installer", "repair")
  await using second = child(tmp.filename, "installer")
  expect(await first.next()).toBe("read")
  expect(await second.next()).toBe("read")
  first.send("continue")
  expect(await first.next()).toBe("repairing")
  expect(db.query("SELECT * FROM session_maintenance_runtime").all()).toEqual([])
  expect(() => db.exec("INSERT OR REPLACE INTO part VALUES('during','other','unique')")).toThrow("locked")
  first.send("repair")
  expect(await first.next()).toBe("installed")
  const repaired = db.query<{ schema_version: number }, []>("PRAGMA main.schema_version").get()
  second.send("continue")
  expect(await second.next()).toBe("installed")
  const converged = db.query<{ schema_version: number }, []>("PRAGMA main.schema_version").get()
  expect(repaired?.schema_version).toBeGreaterThan(before?.schema_version ?? 0)
  expect(converged).toEqual(repaired)
  const guards = db.query<{ sql: string }, []>("SELECT sql FROM main.sqlite_master WHERE type='trigger' AND name IN ('session_conflict_part_INSERT','session_conflict_part_UPDATE')").all()
  expect(guards).toHaveLength(2)
  expect(guards.every(guard => guard.sql.includes('existing."data"'))).toBe(true)
  expect(db.query("SELECT protocol FROM session_maintenance_runtime ORDER BY pid").all()).toEqual([{ protocol: 3 }, { protocol: 3 }])
  expect(() => db.exec("INSERT OR REPLACE INTO part VALUES('new','other','unique')")).toThrow("session_under_maintenance")
  expect(db.query("SELECT id,session_id,data FROM part").all()).toEqual([{ id: "protected", session_id: "owner", data: "unique" }])
  first.send("close")
  expect(await first.process.exited).toBe(0)
  second.send("close")
  expect(await second.process.exited).toBe(0)
}, 20_000)

test("four schema changes exhaust three replans without publishing capability", async () => {
  await using tmp = await fixture()
  await install(tmp.filename, async () => {})
  const state = { registration: 0 }
  const queries: string[] = []
  await expect(install(tmp.filename, async (query, phase) => {
    if (phase === "before") queries.push(query.trim())
    if (phase !== "before" || !/^begin immediate$/i.test(query.trim())) return
    state.registration++
    await using writer = child(tmp.filename, "schema", `CREATE TABLE churn_${state.registration}(value TEXT)`)
    expect(await writer.next()).toBe("ready")
    writer.send("change")
    expect(await writer.next()).toBe("changed")
    expect(await writer.process.exited).toBe(0)
  })).rejects.toThrow("exceeded three schema replans")
  expect(state.registration).toBe(4)
  expect(queries.filter(query => /^rollback$/i.test(query))).toHaveLength(4)
  expect(queries.filter(query => /INSERT INTO session_maintenance_runtime/i.test(query))).toEqual([])
  using db = new Database(tmp.filename)
  expect(db.query("SELECT * FROM session_maintenance_runtime").all()).toEqual([])
}, 20_000)

for (const shape of [
  { name: "incompatible maintenance table", ddl: "CREATE TABLE session_maintenance_runtime(connection_id TEXT PRIMARY KEY,pid TEXT,identity TEXT,protocol TEXT)", error: "incompatible maintenance table definition" },
  { name: "partial unique index", ddl: "CREATE UNIQUE INDEX partial_part ON part(data) WHERE data IS NOT NULL", error: "partial unique index" },
  { name: "expression unique index", ddl: "CREATE UNIQUE INDEX expression_part ON part(lower(data))", error: "expression" },
]) {
  test(`${shape.name} fails closed before capability publication`, async () => {
    await using tmp = await fixture()
    using db = new Database(tmp.filename)
    db.exec(shape.ddl)
    const queries: string[] = []
    await expect(install(tmp.filename, async (query, phase) => { if (phase === "before") queries.push(query) })).rejects.toThrow(shape.error)
    expect(queries.filter(query => /INSERT INTO session_maintenance_runtime/i.test(query))).toEqual([])
  })
}

test("emergency activation publishes protocol zero atomically before a competing active fence", async () => {
  // Given canonical conflict guards, an emergency marker, and an independent fence writer.
  await using tmp = await fixture()
  using inspect = new Database(tmp.filename)
  inspect.exec("CREATE UNIQUE INDEX part_data ON part(data); INSERT INTO part VALUES('protected','owner','unique')")
  await install(tmp.filename, async () => {})
  await Bun.write(`${tmp.filename}.conflict-guards-disabled`, "")
  await using writer = child(tmp.filename, "fence")
  expect(await writer.next()).toBe("ready")
  const protocols: number[] = []
  const state = { immediate: false, dropped: false, committed: false, protocols }
  // When activation pauses after an actual guard DROP and again after its writer COMMIT.
  await Effect.runPromise(Effect.gen(function* () {
    const db = yield* connection(tmp.filename, async (query, phase) => {
      if (phase === "before" && /^begin immediate$/i.test(query.trim())) state.immediate = true
      if (phase !== "after") return
      if (/^DROP TRIGGER/i.test(query.trim()) && !state.dropped) {
        state.dropped = true
        writer.send("attempt")
        expect(await writer.next()).toBe("blocked")
        expect(inspect.query("SELECT * FROM session_maintenance_runtime").all()).toEqual([])
      }
      if (!/^commit$/i.test(query.trim()) || !state.immediate || state.committed) return
      state.committed = true
      state.protocols = inspect.query<{ protocol: number }, []>("SELECT protocol FROM session_maintenance_runtime").all().map(row => row.protocol)
      writer.send("attempt")
      expect(await writer.next()).toBe("fenced")
      expect(await writer.process.exited).toBe(0)
    })
    const result = yield* SessionMaintenance.install(db).pipe(Effect.exit)
    const guards = inspect.query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE name IN ('session_conflict_part_INSERT','session_conflict_part_UPDATE')").all()
    console.info("emergency activation boundary:", { result: result._tag, protocolsAtCommit: state.protocols, inertGuards: guards.filter(guard => /WHEN 0/.test(guard.sql)).length })
    // Then disabled guards and protocol zero are committed together, not left behind by refusal.
    expect(state.dropped).toBe(true)
    expect(state.protocols).toEqual([0])
    expect(result._tag).toBe("Success")
    expect(guards).toHaveLength(2)
    expect(guards.every(guard => /WHEN 0/.test(guard.sql))).toBe(true)
  }).pipe(Effect.scoped))
}, 20_000)

test("quoted trigger names cannot certify a guard attached to a whitespace-distinct table", async () => {
  // Given two distinct quoted tables and a generated same-name guard attached to the wrong one.
  await using tmp = await fixture()
  using inspect = new Database(tmp.filename)
  inspect.exec('CREATE TABLE "owner  rows"(id TEXT PRIMARY KEY,session_id TEXT); CREATE TABLE "owner rows"(id TEXT PRIMARY KEY,session_id TEXT)')
  await install(tmp.filename, async () => {})
  const canonical = SessionMaintenanceSql.triggers({ table: "owner  rows", columns: ["session_id"] })[0]
  if (!canonical) throw new Error("generated INSERT guard required")
  inspect.exec('DROP TRIGGER "session_maintenance_owner  rows_INSERT"')
  inspect.exec(canonical.replace('ON "owner  rows"', 'ON "owner rows"'))
  inspect.exec("INSERT INTO session_maintenance_fence VALUES('owner','active','replacement')")
  // When startup verifies guards against the real SQLite schema.
  await install(tmp.filename, async () => {})
  // Then the intended table rejects the fenced write and retains no inserted row.
  expect(() => inspect.exec('INSERT INTO "owner  rows" VALUES(\'target\',\'owner\')')).toThrow("session_under_maintenance")
  expect(inspect.query('SELECT * FROM "owner  rows"').all()).toEqual([])
})
