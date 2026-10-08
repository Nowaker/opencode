export * as SqliteFailure from "./sqlite-error"

import { isSqlError } from "effect/unstable/sql/SqlError"
import { Cause, Option, Predicate } from "effect"
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors"

const reasons = [
  "ConnectionError",
  "AuthenticationError",
  "AuthorizationError",
  "SqlSyntaxError",
  "UniqueViolation",
  "ConstraintError",
  "DeadlockError",
  "SerializationError",
  "LockTimeoutError",
  "StatementTimeoutError",
  "UnknownError",
] as const

const codes = [
  [1, "SQLITE_ERROR"],
  [2, "SQLITE_INTERNAL"],
  [3, "SQLITE_PERM"],
  [4, "SQLITE_ABORT"],
  [5, "SQLITE_BUSY"],
  [6, "SQLITE_LOCKED"],
  [7, "SQLITE_NOMEM"],
  [8, "SQLITE_READONLY"],
  [9, "SQLITE_INTERRUPT"],
  [10, "SQLITE_IOERR"],
  [11, "SQLITE_CORRUPT"],
  [12, "SQLITE_NOTFOUND"],
  [13, "SQLITE_FULL"],
  [14, "SQLITE_CANTOPEN"],
  [15, "SQLITE_PROTOCOL"],
  [16, "SQLITE_EMPTY"],
  [17, "SQLITE_SCHEMA"],
  [18, "SQLITE_TOOBIG"],
  [19, "SQLITE_CONSTRAINT"],
  [20, "SQLITE_MISMATCH"],
  [21, "SQLITE_MISUSE"],
  [22, "SQLITE_NOLFS"],
  [23, "SQLITE_AUTH"],
  [24, "SQLITE_FORMAT"],
  [25, "SQLITE_RANGE"],
  [26, "SQLITE_NOTADB"],
  [261, "SQLITE_BUSY_RECOVERY"],
  [517, "SQLITE_BUSY_SNAPSHOT"],
  [773, "SQLITE_BUSY_TIMEOUT"],
  [262, "SQLITE_LOCKED_SHAREDCACHE"],
  [518, "SQLITE_LOCKED_VTAB"],
  [2067, "SQLITE_CONSTRAINT_UNIQUE"],
] as const

const operations = ["execute", "begin", "commit", "rollback", "connect", "export", "loadExtension"] as const

export function unwrap(error: unknown) {
  const cause =
    error instanceof EffectDrizzleQueryError && Cause.isCause(error.cause)
      ? Cause.findErrorOption(error.cause)
      : Option.none()
  const value = Option.isSome(cause) ? cause.value : error
  if (isSqlError(value)) return value
}

/** Only fixed vocabulary leaves this boundary, never SQL, parameters or native messages. */
export function parse(error: unknown) {
  if (!isSqlError(error)) return
  const tag = Predicate.hasProperty(error.reason, "_tag") ? error.reason._tag : undefined
  const reason = reasons.find((reason) => reason === tag) ?? "UnknownError"
  const cause = Predicate.hasProperty(error.reason, "cause") ? error.reason.cause : undefined
  const code = Predicate.hasProperty(cause, "code") ? cause.code : undefined
  const errno = Predicate.hasProperty(cause, "errno") ? cause.errno : undefined
  const fromCode = codes.find(([number, name]) => code === number || code === name)
  const fromErrno = codes.find(([number]) => errno === number)
  // Any supplied unknown or contradictory field makes acquisition recovery unsafe.
  const consistent =
    (code === undefined || fromCode !== undefined) &&
    (errno === undefined || fromErrno !== undefined) &&
    (!fromCode || !fromErrno || fromCode[0] === fromErrno[0])
  const nativeCode = consistent ? (fromCode ?? fromErrno)?.[1] : undefined
  return {
    reason,
    operation: operations.find((operation) =>
      Predicate.hasProperty(error.reason, "operation") && operation === error.reason.operation,
    ),
    nativeCode,
    retryAcquisition:
      reason === "LockTimeoutError" &&
      (nativeCode === "SQLITE_BUSY" || nativeCode === "SQLITE_BUSY_RECOVERY" || nativeCode === "SQLITE_BUSY_TIMEOUT"),
  }
}
