export * as SessionMaintenanceTrigger from "./session-maintenance-trigger"

import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { sql } from "drizzle-orm"
import { Effect } from "effect"

const normalize = (value: string) => value.replace(/IF NOT EXISTS /g, "").replace(/CREATE TEMP TRIGGER/g, "CREATE TRIGGER").replace(/\s+/g, " ").trim().replace(/;$/, "")

/** Called inside the installer's IMMEDIATE transaction, so no writer observes
 * the interval between an obsolete guard's removal and its replacement. */
export function install(db: EffectDrizzleSqlite.EffectSQLiteDatabase, statement: string) {
  return Effect.gen(function* () {
    const match = /^\s*CREATE (TEMP )?TRIGGER (?:IF NOT EXISTS )?"((?:[^"]|"")+)"/.exec(statement)
    if (!match?.[2]) return yield* Effect.die(new Error("invalid maintenance trigger definition"))
    const name = match[2].replaceAll('""', '"')
    const schema = match[1] ? "temp" : "main"
    const current = yield* db.get<{ sql: string }>(sql`SELECT sql FROM ${sql.identifier(schema)}.sqlite_master WHERE type='trigger' AND name=${name}`)
    if (current && normalize(current.sql) === normalize(statement)) return
    if (current) yield* db.run(sql`DROP TRIGGER ${sql.identifier(schema)}.${sql.identifier(name)}`)
    yield* db.run(sql.raw(statement))
  })
}
