export * as SessionMaintenance from "./session-maintenance"

import { sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { SessionMaintenanceSql } from "./session-maintenance-sql"
import { SessionMaintenanceTrigger } from "./session-maintenance-trigger"
import { SessionMaintenancePlan } from "./session-maintenance-plan"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"

type Database = EffectDrizzleSqlite.EffectSQLiteDatabase
class SchemaChanged extends Schema.TaggedErrorClass<SchemaChanged>()("MaintenanceSchemaChanged", {}) {}

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
    const stage = (statements: readonly string[]) => Effect.gen(function* () {
      yield* db.run(sql`CREATE TEMP TABLE session_maintenance_snapshot(session_id TEXT PRIMARY KEY,generation INTEGER NOT NULL)`)
      for (const statement of statements) yield* db.run(sql.raw(statement))
    })
    const register = () => Effect.gen(function* () {
      yield* db.run(
        sql`INSERT OR IGNORE INTO session_maintenance_origin SELECT ${process.pid},${identity},json_group_object(session_id,generation) FROM session_maintenance_generation`,
      )
      yield* db.run(
        sql`INSERT INTO temp.session_maintenance_snapshot SELECT key,value FROM json_each((SELECT snapshot FROM session_maintenance_origin WHERE pid=${process.pid} AND identity=${identity}))`,
      )
      const protocol = emergency || started === "unsupported" ? 0 : SessionMaintenanceSql.protocol
      yield* db.run(sql`INSERT INTO session_maintenance_runtime VALUES(${id},${process.pid},${identity},${protocol})`)
    })
    if (emergency) {
      // Disabling persistent guards and publishing protocol zero must share the
      // active-fence check's transaction, not commit in separate startup phases.
      yield* db.transaction(() => Effect.gen(function* () {
        for (const statement of SessionMaintenanceSql.schema) yield* db.run(sql.raw(statement))
        const active = yield* db.get(sql`SELECT 1 FROM session_maintenance_fence WHERE operation<>'' LIMIT 1`)
        if (active) return yield* Effect.die(new Error("cannot disable conflict guards during active maintenance"))
        const plan = yield* SessionMaintenancePlan.discover(db, true)
        for (const statement of plan.repair) yield* db.run(sql.raw(statement))
        yield* stage(plan.temporary)
        yield* register()
      }), { behavior: "immediate" })
      yield* Effect.addFinalizer(() =>
        db.run(sql`DELETE FROM session_maintenance_runtime WHERE connection_id=${id}`).pipe(Effect.orDie),
      )
      return
    }
    for (let replan = 0; replan <= 3; replan++) {
      const observed = yield* db.transaction(() => SessionMaintenancePlan.discover(db, emergency))
      if (observed.repair.length) {
        yield* db.transaction(
          () => Effect.gen(function* () {
            const current = yield* SessionMaintenancePlan.discover(db, emergency)
            for (const statement of current.repair) yield* db.run(sql.raw(statement))
          }),
          { behavior: "immediate" },
        )
      }
      const plan = observed.repair.length
        ? yield* db.transaction(() => SessionMaintenancePlan.discover(db, emergency))
        : observed
      if (plan.repair.length) continue
      yield* stage(plan.temporary)
      const registered = yield* db.transaction(
        () =>
          Effect.gen(function* () {
            const version = yield* db.get<{ schema_version: number }>(sql`PRAGMA main.schema_version`)
            if (version?.schema_version !== plan.version) return yield* Effect.fail(new SchemaChanged())
            yield* register()
            return true
          }),
        { behavior: "immediate" },
      ).pipe(Effect.catchTag("MaintenanceSchemaChanged", () => Effect.succeed(false)))
      if (registered) {
        yield* Effect.addFinalizer(() =>
          db.run(sql`DELETE FROM session_maintenance_runtime WHERE connection_id=${id}`).pipe(Effect.orDie),
        )
        return
      }
      for (const statement of plan.temporary) {
        yield* db.run(sql`DROP TRIGGER temp.${sql.identifier(SessionMaintenanceTrigger.definition(statement).name)}`)
      }
      yield* db.run(sql`DROP TABLE temp.session_maintenance_snapshot`)
    }
    return yield* Effect.die(new Error("maintenance schema changed during startup: exceeded three schema replans"))
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
