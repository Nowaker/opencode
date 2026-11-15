export * as SessionArchive from "./session-archive"

import { Schema } from "effect"
import { optional } from "./schema"

export interface Actor extends Schema.Schema.Type<typeof Actor> {}
export const Actor = Schema.Struct({
  kind: Schema.Literals(["user", "ai", "system"]),
  machine: Schema.NullOr(Schema.String),
  sessionId: optional(Schema.String),
  client: optional(Schema.String),
  tool: optional(Schema.String),
}).annotate({ identifier: "SessionArchiveActor" })

const Action = Schema.Struct({ at: Schema.Finite, note: optional(Schema.String), by: Actor })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  sessionId: Schema.String,
  archived: optional(Action),
  unarchived: optional(Action),
  announcedAt: optional(Schema.Finite),
})

export interface Details extends Schema.Schema.Type<typeof Details> {}
export const Details = Schema.Struct({
  sessionID: Schema.String,
  archivedAt: Schema.Finite,
  note: optional(Schema.String),
  by: optional(Actor),
})

export const Unarchive = Schema.optional(Schema.Boolean).annotate({
  description:
    "Unarchive an archived session before this prompt. Without it a prompt to an archived session is refused with SessionArchivedError.",
})
