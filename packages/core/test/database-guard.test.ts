import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { chmod, link, readFile, stat, symlink } from "node:fs/promises"
import path from "node:path"
import { Effect, Layer } from "effect"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { layer, layerFromClient } from "@opencode/core/database/database"
import { Global } from "@opencode/util/global"
import { withEnv } from "./fixture/env"
import { tmpdir } from "./fixture/tmpdir"

function open(filename: string, data: string) {
  return Effect.runPromise(
    Layer.build(layer({ path: filename })).pipe(
      Effect.scoped,
      Effect.provideService(Global.Service, Global.make({ data })),
    ),
  )
}

describe("v2 database guard", () => {
  test("refuses the v1 default before creating a file", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "opencode.db")

    await expect(open(filename, tmp.path)).rejects.toThrow("default OpenCode v1 database path")

    expect(await Bun.file(filename).exists()).toBe(false)
  })

  test.each(["symlink", "hardlink"])("refuses a %s alias of the v1 default", async (kind) => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "opencode.db")
    await Bun.write(filename, "")
    const alias = path.join(tmp.path, "alias.db")
    await (kind === "symlink" ? symlink(filename, alias) : link(filename, alias))

    await expect(open(alias, tmp.path)).rejects.toThrow("default OpenCode v1 database path")
  })

  test.each([
    ["xdg", "path"],
    ["xdg", "symlink"],
    ["xdg", "hardlink"],
    ["home", "path"],
    ["home", "symlink"],
    ["home", "hardlink"],
  ])("refuses the legacy %s %s when v2 uses a separate data root", async (root, kind) => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    const data = path.join(tmp.path, "xdg")
    const legacy = path.join(root === "xdg" ? data : path.join(home, ".local", "share"), "opencode", "opencode.db")
    const filename = kind === "path" ? legacy : path.join(tmp.path, "alias.db")
    if (kind !== "path") await Bun.write(legacy, "")
    if (kind === "symlink") await symlink(legacy, filename)
    if (kind === "hardlink") await link(legacy, filename)

    await Effect.runPromise(
      withEnv({ XDG_DATA_HOME: data, OPENCODE_TEST_HOME: home }, () =>
        Effect.promise(async () => {
          await expect(open(filename, path.join(data, "opencode2"))).rejects.toThrow("default OpenCode v1 database path")
          expect(await Promise.all(["-wal", "-shm"].map((suffix) => Bun.file(legacy + suffix).exists()))).toEqual([
            false,
            false,
          ])
          if (kind === "path") expect(await Bun.file(legacy).exists()).toBe(false)
        }),
      ),
    )
  })

  test("refuses a dangling database symlink before creating its v1 default target", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "opencode.db")
    const alias = path.join(tmp.path, "chosen.db")
    await symlink(filename, alias)

    await expect(open(alias, tmp.path)).rejects.toThrow("symlink")

    expect(await Promise.all(["", "-wal", "-shm"].map((suffix) => Bun.file(filename + suffix).exists()))).toEqual([
      false,
      false,
      false,
    ])
  })

  test.each([
    [
      "v1 tables",
      "CREATE TABLE session(id); CREATE TABLE message(id); CREATE TABLE part(id)",
      "v1 session, message and part",
    ],
    [
      "trigger poison",
      "CREATE TABLE migration(id); CREATE TRIGGER _vt_refuse_v2_migration BEFORE INSERT ON migration BEGIN SELECT RAISE(ABORT, 'v1'); END",
      "migration guard trigger",
    ],
    ["column poison", "CREATE TABLE event(id, created)", "event.created migration poison"],
    [
      "partially migrated v1 tables",
      "CREATE TABLE session(id); CREATE TABLE message(id); CREATE TABLE part(id); CREATE TABLE session_v2(id)",
      "v1 session, message and part",
    ],
  ])("refuses %s without changing the database", async (_name, sql, reason) => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "explicit.db")
    {
      using db = new Database(filename)
      db.run(sql)
    }
    await chmod(filename, 0o644)
    const before = await readFile(filename)

    await expect(open(filename, tmp.path)).rejects.toThrow(reason)

    expect(await readFile(filename)).toEqual(before)
    expect(await Promise.all(["-wal", "-shm"].map((suffix) => Bun.file(filename + suffix).exists()))).toEqual([false, false])
    if (process.platform !== "win32") expect((await stat(filename)).mode & 0o777).toBe(0o644)
  })

  test("refuses v1 schema from an injected client before migrations", async () => {
    const client = SqliteClient.layer({ filename: ":memory:", disableWAL: true })
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqliteClient.SqliteClient
          yield* sql.unsafe("CREATE TABLE session(id)")
          yield* sql.unsafe("CREATE TABLE message(id)")
          yield* sql.unsafe("CREATE TABLE part(id)")
          yield* Layer.build(layerFromClient)
        }).pipe(Effect.provide(client), Effect.provideService(Global.Service, Global.make()), Effect.scoped),
      ),
    ).rejects.toThrow("v1 session, message and part")
  })

  test("creates and reopens an explicit fresh v2 database", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "opencode-v2.db")
    await open(filename, tmp.path)

    await open(filename, tmp.path)

    using db = new Database(filename, { readonly: true })
    expect(db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_v2'").all()).toEqual([
      { name: "session_v2" },
    ])
  })

  test("allows an explicit in-memory database", async () => {
    await using tmp = await tmpdir()
    await open(":memory:", tmp.path)
  })
})
