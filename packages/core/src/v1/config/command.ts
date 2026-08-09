export * as ConfigCommandV1 from "./command"

import { Schema } from "effect"

export const Info = Schema.Struct({
  template: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String),
  subtask: Schema.optional(Schema.Boolean),
  // Persist the expanded template as a user message and return without ever
  // reaching the model. No assistant message, no provider request.
  native: Schema.optional(Schema.Boolean),
})
export type Info = Schema.Schema.Type<typeof Info>
