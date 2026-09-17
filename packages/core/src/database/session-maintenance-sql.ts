export * as SessionMaintenanceSql from "./session-maintenance-sql"

import { sql } from "drizzle-orm"
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core"

export const protocol = 3
export const schema = [
  "CREATE TABLE IF NOT EXISTS session_maintenance_generation(session_id TEXT PRIMARY KEY, generation INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS session_maintenance_fence(session_id TEXT PRIMARY KEY, operation TEXT NOT NULL, purpose TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS session_maintenance_runtime(connection_id TEXT PRIMARY KEY, pid INTEGER NOT NULL, identity TEXT NOT NULL, protocol INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS session_maintenance_origin(pid INTEGER NOT NULL, identity TEXT NOT NULL, snapshot TEXT NOT NULL, PRIMARY KEY(pid,identity))",
] as const

export const connection = [
  "CREATE TEMP TABLE session_maintenance_snapshot AS SELECT * FROM main.session_maintenance_generation",
] as const

export type Target = { readonly table: string; readonly columns: readonly string[] }
const dialect = new SQLiteSyncDialect()
const actions = ["INSERT", "UPDATE", "DELETE"] as const

export function columns(table: string, names: readonly string[]): readonly string[] {
  if (["session_maintenance_generation", "session_maintenance_fence", "session_maintenance_runtime", "session_maintenance_origin"].includes(table)) return []
  return names.filter(
    (name) =>
      name === "session_id" ||
      name === "aggregate_id" ||
      (table === "session" && (name === "id" || name === "parent_id")),
  )
}

export function triggers(target: Target): readonly string[] {
  return actions.map((action) => {
    const aliases = action === "UPDATE" ? ["OLD", "NEW"] : [action === "DELETE" ? "OLD" : "NEW"]
    const refs = aliases.flatMap((alias) =>
      target.columns.map((column) => sql`${sql.identifier(alias)}.${sql.identifier(column)}`),
    )
    return dialect.sqlToQuery(sql`
      CREATE TRIGGER IF NOT EXISTS ${sql.identifier(`session_maintenance_${target.table}_${action}`)}
      BEFORE ${sql.raw(action)} ON ${sql.identifier(target.table)}
      WHEN EXISTS(SELECT 1 FROM session_maintenance_fence WHERE session_id IN (${sql.join(refs, sql`, `)}))
      BEGIN SELECT RAISE(ABORT, 'session_under_maintenance'); END
    `).sql
  })
}

export function generationTriggers(target: Target): readonly string[] {
  return actions.map((action) => {
    const aliases = action === "UPDATE" ? ["OLD", "NEW"] : [action === "DELETE" ? "OLD" : "NEW"]
    const refs = aliases.flatMap((alias) =>
      target.columns.map((column) => sql`${sql.identifier(alias)}.${sql.identifier(column)}`),
    )
    return dialect.sqlToQuery(sql`
      CREATE TEMP TRIGGER ${sql.identifier(`session_generation_${target.table}_${action}`)}
      BEFORE ${sql.raw(action)} ON main.${sql.identifier(target.table)}
      WHEN EXISTS(
        SELECT 1 FROM main.session_maintenance_generation AS g
        WHERE g.session_id IN (${sql.join(refs, sql`, `)})
        AND g.generation <> COALESCE((SELECT s.generation FROM session_maintenance_snapshot AS s WHERE s.session_id=g.session_id),0)
      )
      BEGIN SELECT RAISE(ABORT, 'session_identity_changed'); END
    `).sql
  })
}
