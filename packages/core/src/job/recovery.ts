import { Schema } from "effect"
import { SessionSchema } from "../session/schema.js"
import { SessionMessage } from "../session/message.js"
import { SubagentGroup } from "../session/subagent-group.js"

export const RecoverySchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("shell"),
    sessionID: SessionSchema.ID,
    shellID: Schema.String,
    command: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("subagent"),
    parentSessionID: SessionSchema.ID,
    childSessionID: SessionSchema.ID,
    agent: Schema.String,
    description: Schema.String,
    notice: Schema.optionalKey(SubagentGroup.Notice),
    group: Schema.optionalKey(Schema.Struct({
      parentSessionID: SessionSchema.ID,
      id: Schema.String,
      notificationID: SessionMessage.ID,
      index: Schema.Int,
      generation: SessionMessage.ID,
    })),
    after: Schema.optionalKey(SessionMessage.ID),
  }),
  Schema.Struct({
    kind: Schema.Literal("image"),
    sessionID: SessionSchema.ID,
    path: Schema.String,
    model: Schema.String,
  }),
])

export type Recovery = typeof RecoverySchema.Type
