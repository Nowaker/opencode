export * as SessionMaintenanceTrigger from "./session-maintenance-trigger"

import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { sql } from "drizzle-orm"
import { Effect } from "effect"

export function normalize(value: string) {
  // Whitespace inside quoted identifiers/literals is part of their identity.
  const tokens = value.match(/"(?:[^"]|"")*"|'(?:[^']|'')*'|`(?:[^`]|``)*`|\[[^\]]*\]|[^"'`\[]+/g) ?? []
  return tokens.map((token) => /^["'`\[]/.test(token)
    ? token
    : token.replace(/IF NOT EXISTS /g, "").replace(/CREATE TEMP TRIGGER/g, "CREATE TRIGGER").replace(/\s+/g, " "),
  ).join("").trim().replace(/;$/, "")
}

export function definition(statement: string) {
  const match = /^\s*CREATE (TEMP )?TRIGGER (?:IF NOT EXISTS )?"((?:[^"]|"")+)"/.exec(statement)
  if (!match?.[2]) throw new Error("invalid maintenance trigger definition")
  return { name: match[2].replaceAll('""', '"'), schema: match[1] ? "temp" : "main" }
}

/** Called inside the installer's IMMEDIATE transaction, so no writer observes
 * the interval between an obsolete guard's removal and its replacement. */
export function install(db: EffectDrizzleSqlite.EffectSQLiteDatabase, statement: string) {
  return Effect.gen(function* () {
    const target = definition(statement)
    const current = yield* db.get<{ sql: string }>(sql`SELECT sql FROM ${sql.identifier(target.schema)}.sqlite_master WHERE type='trigger' AND name=${target.name}`)
    if (current && normalize(current.sql) === normalize(statement)) return
    if (current) yield* db.run(sql`DROP TRIGGER ${sql.identifier(target.schema)}.${sql.identifier(target.name)}`)
    yield* db.run(sql.raw(statement))
  })
}
