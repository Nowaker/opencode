export * as TransactionDiagnostic from "./transaction-diagnostic"

import type { SqlError } from "effect/unstable/sql/SqlError"
import { SqliteFailure } from "./sqlite-error"

export type Details = {
  readonly phase: "acquire" | "body" | "finalize" | "after_commit"
  readonly bodyOutcome?: "success" | "failure"
  readonly nested: boolean
  readonly attempts: number
  readonly elapsedMs: number
}

const diagnostics = new WeakMap<
  SqlError,
  Details & NonNullable<ReturnType<typeof SqliteFailure.parse>> & { readonly pid: number }
>()

export function record(error: SqlError, details: Details) {
  // An inner transaction's failure must not be relabeled by an enclosing body.
  if (diagnostics.has(error)) return
  const failure = SqliteFailure.parse(error)
  if (failure) diagnostics.set(error, { ...details, ...failure, pid: process.pid })
}

export function get(error: unknown) {
  const failure = SqliteFailure.unwrap(error)
  if (failure) return diagnostics.get(failure)
}
