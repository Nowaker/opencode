export * as SessionPauseEvent from "./session-pause-event"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { NonNegativeInt, optional } from "./schema"
import { SessionID } from "./session-id"

/** Who asked for a pause, an unpause or a discard. Stored as sent. */
export interface Source extends Schema.Schema.Type<typeof Source> {}
export const Source = Schema.Struct({
  kind: Schema.Literals(["tui", "tool", "api"]),
  sessionID: optional(Schema.String),
  sessionTitle: optional(Schema.String),
  machine: optional(Schema.String),
  tool: optional(Schema.String),
  client: optional(Schema.String),
}).annotate({ identifier: "SessionPauseSource" })

/** A prompt that arrived while the session was paused and waits for unpause. */
export interface Held extends Schema.Schema.Type<typeof Held> {}
export const Held = Schema.Struct({
  messageID: Schema.String,
  at: NonNegativeInt,
  /** The prompt's first text part `metadata.vibeterm`, copied as it was sent. */
  delivery: optional(Schema.Unknown),
}).annotate({ identifier: "SessionPauseHeld" })

/**
 * The durable pause of a session, stored in `session.metadata.pause`. `pending` while the current step still drains,
 * `paused` once the loop stopped at the step boundary; a `pending` pause with no running loop reads as paused.
 */
export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  at: NonNegativeInt,
  mode: Schema.Literal("soft"),
  state: Schema.Literals(["pending", "paused"]),
  source: Source,
  reason: optional(Schema.String),
  stoppedAt: optional(NonNegativeInt),
  /** The ancestor session whose pause this one inherited. */
  root: optional(Schema.String),
  held: optional(Schema.Array(Held)),
}).annotate({ identifier: "SessionPause" })

export const Updated = define({
  type: "session.pause.updated",
  schema: {
    sessionID: SessionID,
    pause: Schema.NullOr(Info),
  },
})

/** An unpause started the loop that answers the prompts held while paused. */
export const Released = define({
  type: "session.pause.released",
  schema: {
    sessionID: SessionID,
    held: Schema.Array(Held),
  },
})

export const Definitions = inventory(Updated, Released)
