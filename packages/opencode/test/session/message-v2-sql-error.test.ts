import { describe, expect, test } from "bun:test"
import { NodeServices } from "@effect/platform-node"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Database } from "@opencode-ai/core/database/database"
import { NamedError } from "@opencode-ai/core/util/error"
import { sql } from "drizzle-orm"
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors"
import { Cause, Effect, Schema } from "effect"
import { ConstraintError, LockTimeoutError, SqlError, UnknownError } from "effect/unstable/sql/SqlError"
import { MessageV2 } from "../../src/session/message-v2"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const ctx = { providerID: ProviderV2.ID.make("test") }
const it = testEffect(NodeServices.layer)
const privateData = {
  query: "SELECT sql_fixture_private_column FROM sql_fixture_private_table",
  param: "param_fixture_private_value",
  native: "native_fixture_private_message",
  reason: "reason_fixture_private_message",
  path: "/private/path_fixture/database.sqlite",
  stack: "stack_fixture_private_frame",
}

function failure(code: unknown, tag: "LockTimeoutError" | "ConstraintError" | "UnknownError" = "LockTimeoutError") {
  const fields = {
    operation: "execute",
    message: privateData.reason,
    cause: Object.assign(new Error(privateData.native), { code, path: privateData.path, stack: privateData.stack }),
  }
  switch (tag) {
    case "LockTimeoutError":
      return new SqlError({ reason: new LockTimeoutError(fields) })
    case "ConstraintError":
      return new SqlError({ reason: new ConstraintError(fields) })
    case "UnknownError":
      return new SqlError({ reason: new UnknownError(fields) })
  }
}

function wrapped(cause: unknown) {
  return new EffectDrizzleQueryError({ query: privateData.query, params: [privateData.param], cause })
}

describe("session.message-v2.fromError SQL privacy", () => {
  test.each(["direct", "drizzle"])("retains safe busy diagnosis for %s SQL errors", (kind) => {
    // Given query, params, native text, stack and path that must never be serialized.
    const error = failure("SQLITE_BUSY")
    const input = kind === "direct" ? error : wrapped(Cause.fail(error))
    // When the serializer sees a recognized SQL failure.
    const output = MessageV2.fromError(input, ctx)
    // Then it retains the wire shape and only bounded diagnostic facts.
    if (output.name !== "UnknownError") throw new Error("SQL errors must remain UnknownError")
    expect(output).toEqual({
      name: "UnknownError",
      data: { message: "Failed to execute statement (LockTimeoutError; SQLITE_BUSY: database is locked)" },
    })
    expect(Schema.decodeUnknownSync(NamedError.Unknown.Schema)(output)).toEqual(output)
    for (const value of Object.values(privateData)) expect(JSON.stringify(output)).not.toContain(value)
  })

  test.each([
    ["SQLITE_LOCKED", "LockTimeoutError"],
    ["SQLITE_BUSY_SNAPSHOT", "LockTimeoutError"],
    ["SQLITE_CONSTRAINT", "ConstraintError"],
    ["SQLITE_CONSTRAINT_UNIQUE", "ConstraintError"],
    ["SQLITE_IOERR", "UnknownError"],
  ] as const)("preserves %s without exposing native text", (code, reason) => {
    // Given a recognized reason and native identifier.
    const input = wrapped(Cause.fail(failure(code, reason)))
    // When serializing it.
    const output = MessageV2.fromError(input, ctx)
    // Then it is not converted to a provider retry and private values are absent.
    expect(output.name).toBe("UnknownError")
    if (output.name !== "UnknownError") throw new Error("SQL errors must remain UnknownError")
    expect(output.data.message).toContain(reason)
    expect(output.data.message).toContain(code)
    if (code === "SQLITE_LOCKED") expect(output.data.message).toContain("SQLITE_LOCKED: database table is locked")
    expect(output.data.message.length).toBeLessThan(200)
    for (const value of Object.values(privateData)) expect(JSON.stringify(output)).not.toContain(value)
  })

  test.each([
    [5, "SQLITE_BUSY"],
    [6, "SQLITE_LOCKED"],
    [19, "SQLITE_CONSTRAINT"],
    [10, "SQLITE_IOERR"],
  ] as const)("normalizes numeric native identifier %s", (code, identifier) => {
    // Given a numeric SQLite code.
    const input = failure(code)
    // When serializing it.
    const output = MessageV2.fromError(input, ctx)
    // Then the canonical SQLite identifier survives without numeric/native free text.
    if (output.name !== "UnknownError") throw new Error("SQL errors must remain UnknownError")
    expect(output.data.message).toContain(identifier)
    for (const value of Object.values(privateData)) expect(JSON.stringify(output)).not.toContain(value)
  })

  test.each([undefined, privateData.native, "SQLITE_BUSY " + privateData.param, 999999])(
    "bounds the fallback for unknown native code %s",
    (code) => {
      // Given an invalid or absent native identifier.
      const input = failure(code)
      // When serializing it.
      const output = MessageV2.fromError(input, ctx)
      // Then only the known reason remains.
      expect(output).toEqual({
        name: "UnknownError",
        data: { message: "Failed to execute statement (LockTimeoutError)" },
      })
      for (const value of Object.values(privateData)) expect(JSON.stringify(output)).not.toContain(value)
    },
  )

  test("bounds unknown reason and operation strings", () => {
    // Given a branded SqlError whose external fields carry arbitrary text.
    const input = failure(privateData.native)
    Object.assign(input.reason, { _tag: privateData.reason, operation: privateData.path })
    // When serializing it.
    const output = MessageV2.fromError(input, ctx)
    // Then no untrusted tag, operation or message is reflected.
    expect(output).toEqual({ name: "UnknownError", data: { message: "Database operation failed (UnknownError)" } })
    for (const value of Object.values(privateData)) expect(JSON.stringify(output)).not.toContain(value)
  })

  test("selects one typed failure from a multi-reason Drizzle cause", () => {
    // Given a known wrapper with two typed failures and a private defect.
    const input = wrapped(
      Cause.combine(
        Cause.fail(failure("SQLITE_BUSY")),
        Cause.combine(Cause.fail(failure("SQLITE_IOERR")), Cause.die(privateData.stack)),
      ),
    )
    // When serializing the wrapper.
    const output = MessageV2.fromError(input, ctx)
    // Then only the first typed failure contributes safe facts.
    if (output.name !== "UnknownError") throw new Error("SQL errors must remain UnknownError")
    expect(output.data.message).toContain("SQLITE_BUSY")
    expect(output.data.message).not.toContain("SQLITE_IOERR")
    for (const value of Object.values(privateData)) expect(JSON.stringify(output)).not.toContain(value)
  })

  test("does not unwrap arbitrary Error causes", () => {
    // Given a non-SQL error, despite an attached SQL cause.
    const input = new Error("ordinary error", { cause: failure("SQLITE_BUSY") })
    // When serializing it.
    const output = MessageV2.fromError(input, ctx)
    // Then generic classification remains unchanged.
    expect(output).toEqual({ name: "UnknownError", data: { message: "ordinary error" } })
  })

  test.each([
    ["begin", "Failed to begin transaction"],
    ["commit", "Failed to commit transaction"],
    ["rollback", "Failed to roll back transaction"],
    ["connect", "Failed to connect to database"],
    ["export", "Failed to export database"],
    ["loadExtension", "Failed to load database extension"],
  ])("preserves the safe operation %s", (operation, label) => {
    // Given a known operation with private native details.
    const input = failure("SQLITE_BUSY")
    Object.assign(input.reason, { operation })
    // When serializing it.
    const output = MessageV2.fromError(input, ctx)
    // Then the operation is distinguished without exposing the original message.
    expect(output).toEqual({
      name: "UnknownError",
      data: { message: `${label} (LockTimeoutError; SQLITE_BUSY: database is locked)` },
    })
    for (const value of Object.values(privateData)) expect(JSON.stringify(output)).not.toContain(value)
  })

  it.live("serializes a real child-writer lock through the Drizzle adapter", () =>
    Effect.gen(function* () {
      // Given an isolated file database and a separate child holding its writer lock.
      const tmp = yield* tmpdirScoped()
      const filename = `${tmp}/path_fixture_database.sqlite`
      const worker = `${tmp}/writer.ts`
      yield* Effect.promise(() =>
        Bun.write(
          worker,
          `
import { Database } from "bun:sqlite"
using db = new Database(process.argv[2])
db.exec("BEGIN IMMEDIATE")
process.stdout.write("locked\\n")
await Bun.stdin.text()
db.exec("ROLLBACK")
`,
        ),
      )
      yield* Effect.gen(function* () {
        const service = yield* Database.Service
        yield* service.db.run("CREATE TABLE sql_fixture_private_table (value TEXT)")
        yield* service.db.run("PRAGMA busy_timeout = 20")
        const child = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.spawn([process.execPath, worker, filename], {
              stdin: "pipe",
              stdout: "pipe",
              stderr: "pipe",
              env: { HOME: tmp, XDG_CONFIG_HOME: tmp, XDG_DATA_HOME: tmp },
            }),
          ),
          (child) =>
            Effect.promise(async () => {
              child.stdin.end()
              if (child.exitCode === null) child.kill()
              await child.exited
            }),
        )
        const reader = child.stdout.getReader()
        const ready = yield* Effect.promise(() => reader.read())
        reader.releaseLock()
        expect(new TextDecoder().decode(ready.value)).toBe("locked\n")
        // When a real parameterized insert encounters native SQLITE_BUSY.
        const error = yield* service.db
          .run(sql`INSERT INTO sql_fixture_private_table VALUES (${privateData.param})`)
          .pipe(Effect.flip)
        const output = MessageV2.fromError(error, ctx)
        // Then the actual adapter error preserves only its safe lock diagnosis.
        expect(error).toBeInstanceOf(EffectDrizzleQueryError)
        expect(output).toEqual({
          name: "UnknownError",
          data: { message: "Failed to execute statement (LockTimeoutError; SQLITE_BUSY: database is locked)" },
        })
        for (const value of Object.values(privateData)) expect(JSON.stringify(output)).not.toContain(value)
        expect(JSON.stringify(output)).not.toContain(tmp)
      }).pipe(Effect.scoped, Effect.provide(Database.layerFromPath(filename)))
    }),
  )
})
