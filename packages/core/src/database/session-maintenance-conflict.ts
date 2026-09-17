export * as SessionMaintenanceConflict from "./session-maintenance-conflict"

import { sql } from "drizzle-orm"
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core"
import type { SessionMaintenanceSql } from "./session-maintenance-sql"

export type Key = readonly { readonly name: string; readonly collation: string }[]
const dialect = new SQLiteSyncDialect()

/** REPLACE deletes conflicting rows without DELETE triggers on old connections.
 * Guard the existing owners before SQLite applies any conflict resolution. */
export function triggers(target: SessionMaintenanceSql.Target, keys: readonly Key[]): readonly string[] {
  if (keys.length === 0) return []
  const refs = sql.join(target.columns.map(column => sql`existing.${sql.identifier(column)}`), sql`, `)
  const collisions = keys.map(key => sql.join(key.map(column => column.name === "rowid"
    ? sql`existing.rowid = NEW.rowid`
    : sql`existing.${sql.identifier(column.name)} COLLATE ${sql.identifier(column.collation)} = NEW.${sql.identifier(column.name)}`,
  ), sql` AND `))
  const fenced = sql.join(collisions.map(collision => sql`EXISTS(
    SELECT 1 FROM ${sql.identifier(target.table)} existing WHERE ${collision}
    AND EXISTS(SELECT 1 FROM session_maintenance_fence blocked WHERE blocked.session_id IN (${refs}))
  )`), sql` OR `)
  const stale = sql.join(collisions.map(collision => sql`EXISTS(
    SELECT 1 FROM main.${sql.identifier(target.table)} existing WHERE ${collision}
    AND EXISTS(SELECT 1 FROM main.session_maintenance_generation g WHERE g.session_id IN (${refs})
      AND g.generation <> COALESCE((SELECT s.generation FROM session_maintenance_snapshot s WHERE s.session_id=g.session_id),0))
  )`), sql` OR `)
  return (["INSERT", "UPDATE"] as const).flatMap(action => [
    dialect.sqlToQuery(sql`
      CREATE TRIGGER IF NOT EXISTS ${sql.identifier(`session_conflict_${target.table}_${action}`)}
      BEFORE ${sql.raw(action)} ON ${sql.identifier(target.table)}
      WHEN ${fenced}
      BEGIN SELECT RAISE(ABORT, 'session_under_maintenance'); END
    `).sql,
    dialect.sqlToQuery(sql`
      CREATE TEMP TRIGGER ${sql.identifier(`session_generation_conflict_${target.table}_${action}`)}
      BEFORE ${sql.raw(action)} ON main.${sql.identifier(target.table)}
      WHEN ${stale}
      BEGIN SELECT RAISE(ABORT, 'session_identity_changed'); END
    `).sql,
  ])
}
