import { Effect, Option, Schema } from "effect"
import { isRecord } from "@/util/record"

const identity = {
  version: Schema.Literal(1),
  sessionID: Schema.NonEmptyString,
  revision: Schema.Int.check(Schema.isGreaterThan(0)),
  generation: Schema.String.check(Schema.isUUID()),
  conflict: Schema.optionalKey(Schema.Literal(true)),
}

const Stored = Schema.Union([
  Schema.Struct({
    ...identity,
    boundaryMessageID: Schema.Null,
    boundaryCreatedAt: Schema.Null,
    historyFingerprint: Schema.Null,
  }),
  Schema.Struct({
    ...identity,
    boundaryMessageID: Schema.NonEmptyString,
    boundaryCreatedAt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    historyFingerprint: Schema.NonEmptyString,
  }),
])
export type Stored = typeof Stored.Type

const decode = Schema.decodeUnknownOption(Stored, { onExcessProperty: "error" })

type SessionMetadata = {
  readonly id: string
  readonly metadata?: Record<string, unknown>
}

export function read(session: SessionMetadata): Stored | undefined | "unknown" {
  if (session.metadata === undefined) return undefined
  if (!isRecord(session.metadata)) return "unknown"
  if (!Object.hasOwn(session.metadata, "messageHistory")) return undefined
  const stored = Option.getOrUndefined(decode(session.metadata.messageHistory))
  return stored?.sessionID === session.id ? stored : "unknown"
}

export class Error extends Schema.TaggedErrorClass<Error>()("ProtectedMessageHistoryError", {
  sessionID: Schema.String,
  code: Schema.Literal("protected-message-history"),
  message: Schema.String,
}) {}

export function assertWritable(session: SessionMetadata): Effect.Effect<void, Error> {
  const stored = read(session)
  if (!stored || (stored !== "unknown" && stored.boundaryMessageID === null && !stored.conflict)) return Effect.void
  return Effect.fail(new Error({
    sessionID: session.id,
    code: "protected-message-history",
    message: "This session's message history is protected; clear the history boundary before writing.",
  }))
}

export * as MessageHistoryState from "./message-history-state"
