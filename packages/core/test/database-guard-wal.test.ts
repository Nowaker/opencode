import { describe, expect } from "bun:test"
import { constants, Database } from "bun:sqlite"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Cause, Effect, Exit } from "effect"
import { Statement } from "effect/sql"
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors"
import { DatabaseGuard } from "@opencode/core/database/guard"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

function catalog(db: Database) {
  return {
    objects: db.query("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'trigger') ORDER BY name").all(),
    columns: db.query("SELECT name FROM pragma_table_info('event')").all(),
  }
}

function bytes(filename: string) {
  return { main: readFileSync(filename), wal: readFileSync(`${filename}-wal`) }
}

const schemas = [
  {
    name: "v1 tables",
    baseline: "CREATE TABLE session_v2(id)",
    change: "CREATE TABLE session(id); CREATE TABLE message(id); CREATE TABLE part(id)",
    reason: "v1 session, message and part",
  },
  {
    name: "trigger poison",
    baseline: "CREATE TABLE session_v2(id); CREATE TABLE migration(id)",
    change: "CREATE TRIGGER _vt_refuse_v2_migration BEFORE INSERT ON migration BEGIN SELECT RAISE(ABORT, 'v1'); END",
    reason: "migration guard trigger",
  },
  {
    name: "column poison",
    baseline: "CREATE TABLE event(id)",
    change: "ALTER TABLE event ADD COLUMN created INTEGER",
    reason: "event.created migration poison",
  },
] as const

describe("v2 database guard WAL inspection", () => {
  for (const state of ["live", "orphaned"] as const) {
    for (const schema of schemas) {
      it.live(`refuses ${state} WAL-only ${schema.name} that immutable misses and preserves main and WAL bytes`, () =>
        Effect.promise(async () => {
          await using tmp = await tmpdir()
          const filename = path.join(tmp.path, "explicit.db")
          const baseline = (() => {
            using db = new Database(filename)
            db.exec(schema.baseline)
            return catalog(db)
          })()
          // Kill after COMMIT so Bun's exit cleanup cannot close/checkpoint SQLite.
          if (state === "orphaned") {
            const child = Bun.spawnSync(
              [
                process.execPath,
                "--eval",
                `import { Database } from "bun:sqlite";
                  const db = new Database(process.argv[1]);
                  db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0");
                  db.exec(process.argv[2]);
                  process.kill(process.pid, "SIGKILL");`,
                filename,
                `BEGIN; ${schema.change}; COMMIT`,
              ],
              { stdout: "pipe", stderr: "pipe", timeout: 10_000 },
            )
            expect(child.stderr.toString()).toBe("")
            expect(child.signalCode).toBe("SIGKILL")
          }
          // Keep the live writer open until after inspection; never open the orphan as a writer.
          using writer = state === "live" ? new Database(filename) : undefined
          if (writer) {
            writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0")
            const main = readFileSync(filename)
            writer.exec(`BEGIN; ${schema.change}; COMMIT`)
            expect(readFileSync(filename)).toEqual(main)
          }
          const before = bytes(filename)
          const uri = pathToFileURL(filename)
          uri.searchParams.set("immutable", "1")
          {
            using immutable = new Database(uri.href, constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI)
            expect(catalog(immutable)).toEqual(baseline)
          }

          await expect(Effect.runPromise(DatabaseGuard.checkFile(filename, tmp.path))).rejects.toThrow(schema.reason)

          expect(bytes(filename)).toEqual(before)
        }),
      )
    }
  }

  for (const schema of [
    { name: "v1", sql: schemas[0].change, reason: schemas[0].reason },
    { name: "native v2", sql: "CREATE TABLE session_v2(id); CREATE TABLE event(id, created)", reason: undefined },
  ]) {
    it.live(`inspects a closed WAL-mode ${schema.name} database with absent sidecars without changing main bytes`, () =>
      Effect.promise(async () => {
        await using tmp = await tmpdir()
        const filename = path.join(tmp.path, "closed.db")
        {
          using db = new Database(filename)
          db.exec(`PRAGMA journal_mode=WAL; ${schema.sql}`)
        }
        expect(["-wal", "-shm"].map((suffix) => existsSync(filename + suffix))).toEqual([false, false])
        const before = readFileSync(filename)

        const inspection = Effect.runPromise(DatabaseGuard.checkFile(filename, tmp.path))
        if (schema.reason) await expect(inspection).rejects.toThrow(schema.reason)
        if (!schema.reason) await inspection

        // Readonly SQLite may create WAL/SHM bookkeeping; their membership is not the contract.
        expect(readFileSync(filename)).toEqual(before)
      }),
    )
  }

  it.live("accepts native v2 event.created and session_v2 committed only in a live WAL without changing bytes", () =>
    Effect.promise(async () => {
      await using tmp = await tmpdir()
      const filename = path.join(tmp.path, "native.db")
      using writer = new Database(filename)
      writer.exec("PRAGMA journal_mode=WAL; CREATE TABLE session_v2(id); CREATE TABLE event(id, created)")
      const before = bytes(filename)

      await Effect.runPromise(DatabaseGuard.checkFile(filename, tmp.path))

      expect(bytes(filename)).toEqual(before)
    }),
  )

  it.live("uses one catalog snapshot when a writer completes a native v2 schema between reads", () =>
    Effect.promise(async () => {
      await using tmp = await tmpdir()
      const filename = path.join(tmp.path, "snapshot.db")
      using writer = new Database(filename)
      writer.exec("PRAGMA journal_mode=WAL; CREATE TABLE event(id)")

      await Effect.runPromise(
        DatabaseGuard.checkFile(filename, tmp.path).pipe(
          Effect.provideService(Statement.CurrentTransformer, (statement) =>
            Effect.sync(() => {
              if (statement.compile()[0].includes("pragma_table_info"))
                writer.exec("BEGIN; ALTER TABLE event ADD COLUMN created INTEGER; CREATE TABLE session_v2(id); COMMIT")
              return statement
            }),
          ),
        ),
      )

      expect(catalog(writer)).toEqual({
        objects: [
          { name: "event", type: "table" },
          { name: "session_v2", type: "table" },
        ],
        columns: [{ name: "id" }, { name: "created" }],
      })
    }),
  )

  it.live("fails closed after the adapter's bounded busy wait without changing a locked database", () =>
    Effect.promise(async () => {
      await using tmp = await tmpdir()
      const filename = path.join(tmp.path, "locked.db")
      using writer = new Database(filename)
      writer.exec("CREATE TABLE session_v2(id); BEGIN EXCLUSIVE")
      const before = readFileSync(filename)
      const started = performance.now()

      const result = await Effect.runPromiseExit(DatabaseGuard.checkFile(filename, tmp.path))

      if (Exit.isSuccess(result)) throw new TypeError("Expected the guard to reject a locked database")
      const error = Cause.squash(result.cause)
      if (!(error instanceof EffectDrizzleQueryError) || !Cause.isCause(error.cause)) throw error
      expect(Cause.squash(error.cause)).toMatchObject({ reason: { _tag: "LockTimeoutError" } })
      // SQLite's synchronous busy handler cannot use TestClock; allow 3x its default five-second limit.
      expect(performance.now() - started).toBeLessThan(15_000)
      expect(readFileSync(filename)).toEqual(before)
    }),
  )
})
