import { Schema } from "effect"
import { Event } from "./event.js"
import { SessionID } from "./session-id.js"
import { SessionMessage } from "./session-message.js"
import { optional } from "./schema.js"

export const InputRevision = Schema.Struct({ seq: Schema.Int, eventID: Event.ID }).annotate({
  identifier: "Session.InputRevision",
})
export interface InputRevision extends Schema.Schema.Type<typeof InputRevision> {}

export const Recovery = Schema.Struct({
  assistantMessageID: Schema.NullOr(SessionMessage.ID),
  idleMessageID: Schema.NullOr(SessionMessage.ID),
  throughSeq: Schema.Int,
  executionID: Schema.NullOr(Event.ID),
  executionClaim: Schema.NullOr(Schema.Number),
  localActive: Schema.Boolean,
  inputRevision: Schema.NullOr(InputRevision),
  pendingInput: Schema.Boolean,
}).annotate({ identifier: "Session.Recovery" })
export interface Recovery extends Schema.Schema.Type<typeof Recovery> {}

export const InterruptExpected = Schema.Struct({
  executionID: Event.ID,
  inputRevision: Schema.NullOr(InputRevision),
  messageID: SessionMessage.ID.pipe(optional),
  executionClaim: Schema.NullOr(Schema.Number).pipe(optional),
}).annotate({ identifier: "Session.InterruptExpected" })
export interface InterruptExpected extends Schema.Schema.Type<typeof InterruptExpected> {}

export const PromptExpected = Schema.Struct({
  idleMessageID: Schema.NullOr(SessionMessage.ID),
  throughSeq: Schema.Int,
  inputRevision: Schema.NullOr(InputRevision),
}).annotate({ identifier: "Session.PromptExpected" })
export interface PromptExpected extends Schema.Schema.Type<typeof PromptExpected> {}

export const InterruptExperimental = Schema.Struct({ expected: InterruptExpected.pipe(optional) })
export interface InterruptExperimental extends Schema.Schema.Type<typeof InterruptExperimental> {}
export const PromptExperimental = Schema.Struct({ expected: PromptExpected.pipe(optional) })
export interface PromptExperimental extends Schema.Schema.Type<typeof PromptExperimental> {}
export const InterruptBody = Schema.Struct({ experimental: InterruptExperimental.pipe(optional) })
export interface InterruptBody extends Schema.Schema.Type<typeof InterruptBody> {}

export class InterruptGuardError extends Schema.TaggedError<InterruptGuardError>()("Session.InterruptGuardError", {
  accepted: Schema.Literal(false),
  interrupted: Schema.Literal(false),
  reason: Schema.Literals(["message-changed", "execution-changed", "input-changed"]),
  sessionID: SessionID,
}) {}

export class PromptGuardError extends Schema.TaggedError<PromptGuardError>()("Session.PromptGuardError", {
  accepted: Schema.Literal(false),
  reason: Schema.Literals(["not-idle", "input-changed", "idle-changed"]),
  sessionID: SessionID,
}) {}
