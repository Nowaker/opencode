export * as DatabaseGuard from "./guard.js"

import { existsSync, lstatSync, realpathSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { Effect } from "effect"
import { Global } from "@opencode/util/global"
import { sqliteLayer } from "#sqlite"
import { EffectDrizzleSqlite } from "./drizzle.js"

export class Refused extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(
      `OpenCode v2 refused database: ${path}\n${reason}\n` +
        "No v2 migration was started. Set OPENCODE_DB to an explicit v2 database, for example:\n" +
        '  export OPENCODE_DB="$HOME/.local/share/opencode/opencode-v2.db"',
    )
    this.name = "DatabaseGuardError"
  }
}

export function checkPath(filename: string, data: string) {
  if (filename === ":memory:") return
  const file = canonical(filename)
  const defaults = [
    join(data, "opencode.db"),
    join(process.env.XDG_DATA_HOME || join(Global.Path.home, ".local", "share"), "opencode", "opencode.db"),
    join(Global.Path.home, ".local/share/opencode/opencode.db"),
  ]
  if (
    defaults.some((defaultPath) => {
      if (file === canonical(defaultPath)) return true
      if (!existsSync(file) || !existsSync(defaultPath)) return false
      const current = statSync(file)
      const legacy = statSync(defaultPath)
      return current.dev === legacy.dev && current.ino === legacy.ino
    })
  )
    throw new Refused(filename, "This is the default OpenCode v1 database path.")
}

// A fresh v2 schema has event.created too; it is a poison only without session_v2.
// Legacy tables survive an upstream v1 import, so even an already imported copy is refused.
export const checkSchema = Effect.fn("DatabaseGuard.checkSchema")(function* (
  db: EffectDrizzleSqlite.EffectSQLiteDatabase,
  filename: string,
) {
  const objects = yield* db.all<{ name: string; type: string }>(
    "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'trigger')",
  )
  if (objects.some((row) => row.type === "trigger" && row.name === "_vt_refuse_v2_migration"))
    return yield* Effect.die(new Refused(filename, "The Vibeterm v1 migration guard trigger is present."))
  const tables = new Set(objects.filter((row) => row.type === "table").map((row) => row.name))
  if (["session", "message", "part"].every((name) => tables.has(name)))
    return yield* Effect.die(
      new Refused(filename, "The database contains the OpenCode v1 session, message and part tables."),
    )
  if (!tables.has("session_v2") && tables.has("event")) {
    const columns = yield* db.all<{ name: string }>("SELECT name FROM pragma_table_info('event')")
    if (columns.some((row) => row.name === "created"))
      return yield* Effect.die(new Refused(filename, "The Vibeterm v1 event.created migration poison is present."))
  }
})

export const checkFile = Effect.fn("DatabaseGuard.checkFile")(function* (filename: string, data: string) {
  checkPath(filename, data)
  if (filename === ":memory:" || !existsSync(filename)) return
  // Inspect one readonly snapshot without enabling WAL or applying migrations.
  // SQLite may maintain WAL/SHM bookkeeping; immutable would hide WAL-only schema.
  yield* Effect.gen(function* () {
    const db = yield* EffectDrizzleSqlite.makeWithDefaults()
    yield* db.$client.withTransaction(checkSchema(db, filename))
  }).pipe(Effect.provide(sqliteLayer({ filename, readonly: true, disableWAL: true })), Effect.scoped, Effect.orDie)
})

function canonical(filename: string): string {
  const absolute = resolve(filename)
  if (existsSync(absolute)) return realpathSync.native(absolute)
  if (lstatSync(absolute, { throwIfNoEntry: false })?.isSymbolicLink())
    throw new Refused(filename, "The database path contains an unresolved symlink.")
  const parent = dirname(absolute)
  return parent === absolute ? absolute : join(canonical(parent), absolute.slice(parent.length + 1))
}
