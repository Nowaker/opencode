import { expect, test } from "bun:test"
import { SqliteFailure } from "../src/database/sqlite-error"
import { classifySqliteError, LockTimeoutError, SqlError, UnknownError } from "effect/unstable/sql/SqlError"

test.each([
  [{ code: "SQLITE_BUSY", errno: 5 }, "SQLITE_BUSY", true],
  [{ code: 5 }, "SQLITE_BUSY", true],
  [{ errno: 5 }, "SQLITE_BUSY", true],
  [{ code: "SQLITE_BUSY_RECOVERY", errno: 261 }, "SQLITE_BUSY_RECOVERY", true],
  [{ code: 773 }, "SQLITE_BUSY_TIMEOUT", true],
  [{ code: "SQLITE_LOCKED", errno: 6 }, "SQLITE_LOCKED", false],
  [{ code: 262 }, "SQLITE_LOCKED_SHAREDCACHE", false],
  [{ code: 518 }, "SQLITE_LOCKED_VTAB", false],
  [{ code: 517 }, "SQLITE_BUSY_SNAPSHOT", false],
  [{ code: "SQLITE_CONSTRAINT", errno: 19 }, "SQLITE_CONSTRAINT", false],
  [{ code: "SQLITE_INTERRUPT", errno: 9 }, "SQLITE_INTERRUPT", false],
  [{ code: "SQLITE_BUSY", errno: 517 }, undefined, false],
  [{ code: "SQLITE_BUSY_UNKNOWN", errno: 5 }, undefined, false],
  [{ code: "SQLITE_BUSY", errno: "5" }, undefined, false],
  [{ code: "SQLITE_BUSY", errno: 1029 }, undefined, false],
  [{}, undefined, false],
] as const)("classifies only unambiguous native acquisition codes (%j)", (cause, nativeCode, retryAcquisition) => {
  const error = new SqlError({ reason: classifySqliteError(cause) })
  const parsed = SqliteFailure.parse(error)
  expect(parsed?.nativeCode).toBe(nativeCode)
  expect(parsed?.retryAcquisition).toBe(retryAcquisition)
})

test("ignores native free text and unrecognized operation metadata", () => {
  const error = new SqlError({
    reason: new LockTimeoutError({
      cause: { code: "SQLITE_BUSY", message: "private native data", sql: "private query", params: ["private value"] },
      operation: "private operation",
      message: "private statement",
    }),
  })
  expect(SqliteFailure.parse(error)).toEqual({
    reason: "LockTimeoutError", operation: undefined, nativeCode: "SQLITE_BUSY", retryAcquisition: true,
  })
})

test("rejects non-SQL failures and BUSY with a non-lock reason", () => {
  expect(SqliteFailure.parse({ code: "SQLITE_BUSY" })).toBeUndefined()
  expect(SqliteFailure.parse(new SqlError({ reason: new UnknownError({ cause: { code: 5 } }) }))?.retryAcquisition).toBe(false)
})

test("bounds malformed branded SQL errors to an unknown reason", () => {
  expect(SqliteFailure.parse({ "~effect/sql/SqlError": true, reason: { _tag: "private tag", cause: { code: 5 } } }))
    .toEqual({ reason: "UnknownError", operation: undefined, nativeCode: "SQLITE_BUSY", retryAcquisition: false })
  expect(SqliteFailure.parse({ "~effect/sql/SqlError": true }))
    .toEqual({ reason: "UnknownError", operation: undefined, nativeCode: undefined, retryAcquisition: false })
})
