import { Schema } from "effect"

const fields = {
  id: Schema.String,
  execution: Schema.Literal("server"),
  call_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  namespace: Schema.optional(Schema.String),
  encrypted_content: Schema.optional(Schema.NullOr(Schema.String)),
  arguments: Schema.optional(Schema.String),
}

export const OpenAISearchItem = Schema.Union([
  Schema.StructWithRest(
    Schema.Struct({ ...fields, type: Schema.Literal("tool_search_call"), arguments: Schema.Record(Schema.String, Schema.Unknown) }),
    [Schema.Record(Schema.String, Schema.Unknown)],
  ),
  Schema.StructWithRest(
    Schema.Struct({ ...fields, type: Schema.Literal("tool_search_output"), tools: Schema.Array(Schema.Unknown) }),
    [Schema.Record(Schema.String, Schema.Unknown)],
  ),
])
