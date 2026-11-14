import { Effect, Schema } from "effect"
import { Base64 } from "effect/encoding"
import { JsonObject, optionalNull, ProviderShared } from "../shared.js"
import { ResponsesHostedTools } from "./responses-hosted-tools.js"
import { OpenAISearchItem } from "./tool-search-items.js"

export const OpenAIResponsesHostedToolItem = Schema.Union([
  OpenAISearchItem,
  Schema.StructWithRest(
    Schema.Struct({
      type: Schema.tag("computer_call"),
      id: Schema.String,
      status: Schema.optional(Schema.String),
      call_id: Schema.optional(Schema.String),
      action: optionalNull(JsonObject),
      pending_safety_checks: Schema.optional(Schema.Array(JsonObject)),
    }),
    [JsonObject],
  ),
  Schema.StructWithRest(
    Schema.Struct({
      type: Schema.tag("web_search_preview_call"),
      id: Schema.String,
      status: Schema.optional(Schema.String),
      action: optionalNull(JsonObject),
    }),
    [JsonObject],
  ),
  Schema.StructWithRest(
    Schema.Struct({
      type: Schema.tag("image_generation_call"),
      id: Schema.String,
      status: Schema.optional(Schema.String),
      result: optionalNull(Schema.String),
      output_format: Schema.optional(Schema.Literals(["png", "jpeg", "webp"])),
      revised_prompt: optionalNull(Schema.String),
    }),
    [JsonObject],
  ),
])

const hostedToolResult = Effect.fnUntraced(function* (item: ResponsesHostedTools.Item) {
  const isError = item.error !== undefined && item.error !== null
  if (item.type === "image_generation_call" && item.result) {
    yield* Effect.fromResult(Base64.decode(item.result)).pipe(
      Effect.mapError((cause) =>
        ProviderShared.eventError(
          "openai-responses",
          "OpenAI Responses returned invalid image base64",
          undefined,
          cause,
        ),
      ),
    )
    const format = item.output_format ?? "png"
    return {
      type: "content" as const,
      value: [{ type: "file" as const, uri: `data:image/${format};base64,${item.result}`, mime: `image/${format}` }],
    }
  }
  return isError ? { type: "error" as const, value: item.error } : { type: "json" as const, value: item }
})

export const HOSTED_TOOLS = {
  ...ResponsesHostedTools.common,
  web_search_preview_call: { name: "web_search_preview", input: (item) => item.action ?? {} },
  computer_call: { name: "computer_use", input: (item) => item.action ?? {} },
  image_generation_call: { name: "image_generation", input: () => ({}), result: hostedToolResult },
  tool_search_call: { name: "tool_search", input: (item) => item.arguments ?? {} },
  tool_search_output: { name: "tool_search", input: () => ({}) },
} as const satisfies ResponsesHostedTools.Definitions
