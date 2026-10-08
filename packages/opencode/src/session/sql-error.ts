import { SqliteFailure } from "@opencode-ai/core/database/sqlite-error"

const operations = {
  execute: "Failed to execute statement",
  begin: "Failed to begin transaction",
  commit: "Failed to commit transaction",
  rollback: "Failed to roll back transaction",
  connect: "Failed to connect to database",
  export: "Failed to export database",
  loadExtension: "Failed to load database extension",
} as const

export function message(error: unknown) {
  const failure = SqliteFailure.parse(SqliteFailure.unwrap(error))
  if (!failure) return
  const operation = failure.operation ? operations[failure.operation] : "Database operation failed"
  const explanation = failure.nativeCode?.startsWith("SQLITE_BUSY")
    ? ": database is locked"
    : failure.nativeCode?.startsWith("SQLITE_LOCKED")
      ? ": database table is locked"
      : ""
  const code = failure.nativeCode ? `; ${failure.nativeCode}${explanation}` : ""
  return `${operation} (${failure.reason}${code})`
}

export * as SqlErrorMessage from "./sql-error"
