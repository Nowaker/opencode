import { Schema } from "effect"
import type { ProviderMetadata, ToolResultPart } from "../../schema/index.js"
import type { ProviderAdapter } from "../open-responses.js"
import { JsonObject, optionalNull, optionalNullish } from "../shared.js"
import { OpenAISearchItem } from "./tool-search-items.js"

const OpenResponsesWebSearchCall = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.tag("web_search_call"),
    id: Schema.String,
    status: Schema.optional(Schema.String),
    action: optionalNull(JsonObject),
  }),
  [JsonObject],
)
const OpenResponsesFileSearchCall = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.tag("file_search_call"),
    id: Schema.String,
    status: Schema.optional(Schema.String),
    queries: Schema.optional(Schema.Array(Schema.String)),
    results: optionalNull(Schema.Array(JsonObject)),
  }),
  [JsonObject],
)
const OpenResponsesCodeInterpreterCall = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.tag("code_interpreter_call"),
    id: Schema.String,
    status: Schema.optional(Schema.String),
    code: optionalNull(Schema.String),
    container_id: optionalNull(Schema.String),
    outputs: optionalNull(Schema.Array(JsonObject)),
  }),
  [JsonObject],
)
const OpenResponsesMCPCall = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.tag("mcp_call"),
    id: Schema.String,
    status: Schema.optional(Schema.String),
    server_label: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
    arguments: Schema.optional(Schema.String),
    output: optionalNull(Schema.String),
    error: Schema.optional(Schema.Unknown),
  }),
  [JsonObject],
)

export const HostedToolItem = Schema.Union([
  OpenResponsesWebSearchCall,
  OpenResponsesFileSearchCall,
  OpenResponsesCodeInterpreterCall,
  OpenResponsesMCPCall,
])
export type HostedToolItem = Schema.Schema.Type<typeof HostedToolItem>

export const HostedToolReplay = Schema.StructWithRest(Schema.Struct({ type: Schema.String, id: Schema.String }), [
  JsonObject,
])
export type HostedToolReplayItem = Schema.Schema.Type<typeof HostedToolReplay>

// Gateways can omit item ids; the parser recovers or mints the normalized identity later.
const GenericStreamItem = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.String,
    id: optionalNullish(Schema.String),
    call_id: optionalNullish(Schema.String),
    name: optionalNullish(Schema.String),
    namespace: optionalNullish(Schema.String),
    arguments: optionalNullish(Schema.String),
    encrypted_content: optionalNull(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
).check(Schema.makeFilter((item) => item.type !== "tool_search_call" && item.type !== "tool_search_output"))
export const StreamItem = Schema.Union([OpenAISearchItem, GenericStreamItem])
export type StreamItem = Schema.Schema.Type<typeof StreamItem>
export type OutputItem = StreamItem & { readonly id: string }

// Item prefixes are provider-defined, so only require a nonempty prefix and suffix.
export const itemID = (providerMetadata: ProviderMetadata | undefined, providerMetadataKey: string) => {
  const metadata = providerMetadata?.[providerMetadataKey]
  if (!metadata || typeof metadata.itemId !== "string") return undefined
  const separator = metadata.itemId.indexOf("_")
  return separator > 0 && separator < metadata.itemId.length - 1 ? metadata.itemId : undefined
}

export const restoreHostedTool = (
  part: ToolResultPart,
  providerMetadataKey: string,
  restore: ProviderAdapter["restoreHostedToolItem"],
) => {
  const id = itemID(part.providerMetadata, providerMetadataKey)
  const saved = restore?.(part.providerMetadata?.[providerMetadataKey]?.item)
  const hosted =
    saved ??
    (part.result.type !== "json"
      ? undefined
      : Schema.is(HostedToolItem)(part.result.value)
        ? part.result.value
        : restore?.(part.result.value))
  return id !== undefined && hosted && (saved !== undefined || hosted.id === id) ? { id, item: hosted } : undefined
}
