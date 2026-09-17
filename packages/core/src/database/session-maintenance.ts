export * as SessionMaintenance from "./session-maintenance"

import { sql } from "drizzle-orm"
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core"
import { Effect } from "effect"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { SessionMaintenanceSql } from "./session-maintenance-sql"
import { SessionMaintenanceConflict } from "./session-maintenance-conflict"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"

type Database = EffectDrizzleSqlite.EffectSQLiteDatabase

export function install(db: Database) {
  return Effect.gen(function* () {
    const database = yield* db.get<{ file: string }>(sql`SELECT file FROM pragma_database_list WHERE name='main'`)
    const emergency = Boolean(database?.file && existsSync(`${database.file}.conflict-guards-disabled`))
    const id = randomUUID()
    const started =
      process.platform === "linux"
        ? readFileSync(`/proc/${process.pid}/stat`, "utf8").split(") ").at(-1)?.split(" ")[19]
        : process.platform === "darwin"
          ? execFileSync("ps", ["-p", String(process.pid), "-o", "lstart="], { encoding: "utf8" }).trim()
          : "unsupported"
    if (!started) return yield* Effect.die(new Error("cannot establish maintenance runtime identity"))
    const identity =
      process.platform === "linux"
        ? `${readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()}:${started}`
        : started
    yield* db.transaction(
      () =>
        Effect.gen(function* () {
          for (const statement of SessionMaintenanceSql.schema) yield* db.run(sql.raw(statement))
          if (emergency) {
            const active = yield* db.get(sql`SELECT 1 FROM session_maintenance_fence WHERE operation<>'' LIMIT 1`)
            if (active) return yield* Effect.die(new Error("cannot disable conflict guards during active maintenance"))
          }
          yield* db.run(
            sql`INSERT OR IGNORE INTO session_maintenance_origin SELECT ${process.pid},${identity},json_group_object(session_id,generation) FROM session_maintenance_generation`,
          )
          yield* db.run(
            sql`CREATE TEMP TABLE session_maintenance_snapshot(session_id TEXT PRIMARY KEY,generation INTEGER NOT NULL)`,
          )
          yield* db.run(
            sql`INSERT INTO temp.session_maintenance_snapshot SELECT key,value FROM json_each((SELECT snapshot FROM session_maintenance_origin WHERE pid=${process.pid} AND identity=${identity}))`,
          )
          const tables = yield* db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type='table'`)
          for (const table of tables) {
            const info = yield* db.all<{ name: string }>(sql`SELECT name FROM pragma_table_info(${table.name})`)
            const columns = SessionMaintenanceSql.columns(
              table.name,
              info.map((column) => column.name),
            )
            if (columns.length === 0) continue
            const target = { table: table.name, columns }
            for (const statement of SessionMaintenanceSql.triggers(target)) yield* db.run(sql.raw(statement))
            for (const statement of SessionMaintenanceSql.generationTriggers(target)) yield* db.run(sql.raw(statement))
            if (emergency) {
              // Same-name placeholders block legacy IF NOT EXISTS installers and
              // deliberately fail canonical schema validation for replacement.
              for (const action of ["INSERT", "UPDATE"] as const) {
                const name = `session_conflict_${target.table}_${action}`
                const statement = new SQLiteSyncDialect().sqlToQuery(sql`CREATE TRIGGER ${sql.identifier(name)} BEFORE ${sql.raw(action)} ON ${sql.identifier(target.table)} WHEN 0 BEGIN SELECT 1; END`).sql
                const existing = yield* db.get<{ sql: string }>(sql`SELECT sql FROM sqlite_master WHERE type='trigger' AND name=${name}`)
                if (existing?.sql === statement) continue
                yield* db.run(sql`DROP TRIGGER IF EXISTS ${sql.identifier(name)}`)
                yield* db.run(sql.raw(statement))
              }
              continue
            }
            const keys: SessionMaintenanceConflict.Key[] = []
            const layout = yield* db.get<{ wr: number }>(sql`SELECT wr FROM pragma_table_list WHERE schema='main' AND name=${table.name}`)
            if (layout?.wr === 0) keys.push([{ name: "rowid", collation: "BINARY" }])
            const indexes = yield* db.all<{ name: string }>(sql`SELECT name FROM pragma_index_list(${table.name}) WHERE "unique"=1`)
            for (const index of indexes) {
              const fields = yield* db.all<{ name: string | null; coll: string }>(sql`SELECT name,coll FROM pragma_index_xinfo(${index.name}) WHERE "key"=1 ORDER BY seqno`)
              const key: Array<{ name: string; collation: string }> = []
              for (const field of fields) {
                if (field.name === null) return yield* Effect.die(new Error("maintenance cannot guard an expression-based unique index"))
                key.push({ name: field.name, collation: field.coll })
              }
              if (key.length) keys.push(key)
            }
            for (const statement of SessionMaintenanceConflict.triggers(target, keys)) yield* db.run(sql.raw(statement))
          }
          const protocol = emergency || started === "unsupported" ? 0 : SessionMaintenanceSql.protocol
          yield* db.run(
            sql`INSERT INTO session_maintenance_runtime VALUES(${id},${process.pid},${identity},${protocol})`,
          )
        }),
      { behavior: "immediate" },
    )
    yield* Effect.addFinalizer(() =>
      db.run(sql`DELETE FROM session_maintenance_runtime WHERE connection_id=${id}`).pipe(Effect.orDie),
    )
  })
}

export function assertCurrent(db: Database, sessionID: string) {
  return Effect.gen(function* () {
    const fenced = yield* db.get(
      sql`SELECT 1 FROM session_maintenance_fence WHERE session_id=${sessionID} AND operation<>''`,
    )
    if (fenced) return yield* Effect.die(new Error("session_under_maintenance"))
    const stale = yield* db.get(sql`
      SELECT 1 FROM session_maintenance_generation AS g
      WHERE g.session_id=${sessionID} AND g.generation <> COALESCE(
        (SELECT generation FROM temp.session_maintenance_snapshot WHERE session_id=${sessionID}),0
      )
    `)
    if (stale)
      return yield* Effect.die(new Error("session_identity_changed: restart this runtime before reopening the session"))
  })
}
