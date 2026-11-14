import { Schema } from "effect"
import { JsonObject } from "../shared.js"

export const AnthropicStreamBlock = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.String,
    id: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
    text: Schema.optional(Schema.String),
    thinking: Schema.optional(Schema.String),
    signature: Schema.optional(Schema.String),
    // redacted_thinking blocks arrive whole in content_block_start with the
    // encrypted payload in `data`; there is no streaming delta sequence.
    data: Schema.optional(Schema.String),
    input: Schema.optional(Schema.Unknown),
    // *_tool_result blocks arrive whole as content_block_start (no streaming
    // delta) with the structured payload in `content` and the originating
    // server_tool_use id in `tool_use_id`.
    tool_use_id: Schema.optional(Schema.String),
    content: Schema.optional(Schema.Unknown),
  }),
  [JsonObject],
)
export type AnthropicStreamBlock = Schema.Schema.Type<typeof AnthropicStreamBlock>
export const decodeAnthropicStreamBlock = Schema.decodeUnknownOption(AnthropicStreamBlock)
