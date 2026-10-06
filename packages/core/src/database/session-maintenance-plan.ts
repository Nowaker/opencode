export * as SessionMaintenancePlan from "./session-maintenance-plan"

import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { sql } from "drizzle-orm"
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core"
import { Effect } from "effect"
import { SessionMaintenanceSql } from "./session-maintenance-sql"
import { SessionMaintenanceConflict } from "./session-maintenance-conflict"
import { SessionMaintenanceTrigger } from "./session-maintenance-trigger"

const dialect = new SQLiteSyncDialect()

/** The caller holds a consistent read snapshot, or the repair writer lock. */
export function discover(db: EffectDrizzleSqlite.EffectSQLiteDatabase, emergency: boolean) {
  return Effect.gen(function* () {
    const version = yield* db.get<{ schema_version: number }>(sql`PRAGMA main.schema_version`)
    if (!version) return yield* Effect.die(new Error("cannot read maintenance schema version"))
    const objects = yield* db.all<{ type: string; name: string; sql: string | null }>(
      sql`SELECT type,name,sql FROM main.sqlite_master WHERE type IN ('table','view','trigger')`,
    )
    const repair: string[] = []
    const temporary: string[] = []
    for (const statement of SessionMaintenanceSql.schema) {
      const name = /^CREATE TABLE IF NOT EXISTS (\w+)\(/.exec(statement)?.[1]
      if (!name) return yield* Effect.die(new Error("invalid maintenance table definition"))
      const current = objects.find((object) => object.name === name)
      if (!current) {
        repair.push(statement)
        continue
      }
      // These tables are protocol-owned. Reject incompatible definitions instead
      // of rebuilding durable origins, generations, or fences.
      if (current.type !== "table" || !current.sql ||
        SessionMaintenanceTrigger.normalize(current.sql) !== SessionMaintenanceTrigger.normalize(statement))
        return yield* Effect.die(new Error(`incompatible maintenance table definition: ${name}`))
    }
    const persistent: string[] = []
    for (const table of objects.filter((object) => object.type === "table")) {
      const info = yield* db.all<{ name: string; type: string; notnull: number; pk: number; hidden: number }>(
        sql`SELECT name,type,"notnull",pk,hidden FROM pragma_table_xinfo(${table.name},'main')`,
      )
      const columns = SessionMaintenanceSql.columns(table.name, info.map((column) => column.name))
      if (columns.length === 0) continue
      const target = { table: table.name, columns }
      persistent.push(...SessionMaintenanceSql.triggers(target))
      temporary.push(...SessionMaintenanceSql.generationTriggers(target))
      const keys: SessionMaintenanceConflict.Key[] = []
      const layout = yield* db.get<{ wr: number }>(
        sql`SELECT wr FROM pragma_table_list WHERE schema='main' AND name=${table.name}`,
      )
      if (layout?.wr === 0) keys.push([{ name: "rowid", collation: "BINARY" }])
      const indexes = yield* db.all<{ name: string; partial: number }>(
        sql`SELECT name,partial FROM pragma_index_list(${table.name},'main') WHERE "unique"=1`,
      )
      for (const index of indexes) {
        if (index.partial) return yield* Effect.die(new Error("maintenance cannot guarantee indexed lookup for a partial unique index"))
        const fields = yield* db.all<{ name: string | null; coll: string }>(
          sql`SELECT name,coll FROM pragma_index_xinfo(${index.name},'main') WHERE "key"=1 ORDER BY seqno`,
        )
        const key: Array<{ name: string; collation: string }> = []
        for (const field of fields) {
          if (field.name === null) return yield* Effect.die(new Error("maintenance cannot guard an expression-based unique index"))
          key.push({ name: field.name, collation: field.coll })
        }
        if (key.length) keys.push(key)
      }
      if (emergency) {
        for (const action of ["INSERT", "UPDATE"] as const) {
          persistent.push(dialect.sqlToQuery(sql`
            CREATE TRIGGER ${sql.identifier(`session_conflict_${target.table}_${action}`)}
            BEFORE ${sql.raw(action)} ON ${sql.identifier(target.table)} WHEN 0 BEGIN SELECT 1; END
          `).sql)
        }
        continue
      }
      for (const statement of SessionMaintenanceConflict.triggers(target, keys)) {
        const destination = SessionMaintenanceTrigger.definition(statement).schema === "temp" ? temporary : persistent
        destination.push(statement)
      }
    }
    for (const statement of persistent) {
      const definition = SessionMaintenanceTrigger.definition(statement)
      const current = objects.find((object) => object.type === "trigger" && object.name === definition.name)
      if (current?.sql && SessionMaintenanceTrigger.normalize(current.sql) === SessionMaintenanceTrigger.normalize(statement)) continue
      if (current) repair.push(dialect.sqlToQuery(sql`DROP TRIGGER main.${sql.identifier(definition.name)}`).sql)
      repair.push(statement)
    }
    return { version: version.schema_version, repair, temporary }
  })
}
