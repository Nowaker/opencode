import { Effect, Schema } from "effect"
import { CacheTTL, LLMEvent, type ToolCallPart, type ToolDefinition, type ToolResultPart } from "../../schema/index.js"
import { AnthropicSearch } from "../../tool-search.js"
import { JsonObject, ProviderShared } from "../shared.js"
import type { AnthropicStreamBlock } from "./anthropic-stream-block.js"

export const AnthropicCacheControl = Schema.Struct({
  type: Schema.tag("ephemeral"),
  ttl: Schema.optional(CacheTTL),
})

export const AnthropicTool = Schema.Union([
  Schema.Struct({
    name: Schema.String,
    description: Schema.String,
    input_schema: JsonObject,
    defer_loading: Schema.optional(Schema.Boolean),
    cache_control: Schema.optional(AnthropicCacheControl),
  }),
  Schema.Struct({
    type: Schema.Literals(["tool_search_tool_regex_20251119", "tool_search_tool_bm25_20251119"]),
    name: Schema.String,
    cache_control: Schema.optional(AnthropicCacheControl),
  }),
])
type AnthropicTool = Schema.Schema.Type<typeof AnthropicTool>

export const lowerTool = (
  tool: ToolDefinition,
  cache: Schema.Schema.Type<typeof AnthropicCacheControl> | undefined,
): AnthropicTool => {
  const native = tool.native?.anthropic
  if (Schema.is(AnthropicSearch)(native)) return { ...native, cache_control: cache }
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
    ...(tool.deferred === true ? { defer_loading: true } : {}),
    cache_control: cache,
  }
}

export const AnthropicServerToolUseBlock = Schema.Struct({
  type: Schema.tag("server_tool_use"),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Unknown,
  cache_control: Schema.optional(AnthropicCacheControl),
})

// Server tool results are provider-executed assistant blocks, not client tool results.
// Keep their complete structured content for the next stateless request.
const AnthropicServerToolResultType = Schema.Literals([
  "web_search_tool_result",
  "code_execution_tool_result",
  "web_fetch_tool_result",
  "tool_search_tool_result",
])
type AnthropicServerToolResultType = Schema.Schema.Type<typeof AnthropicServerToolResultType>

export const AnthropicServerToolResultBlock = Schema.Struct({
  type: AnthropicServerToolResultType,
  tool_use_id: Schema.String,
  content: Schema.Unknown,
  cache_control: Schema.optional(AnthropicCacheControl),
})

export const scrubToolCallID = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_")

export const lowerServerToolCall = (part: ToolCallPart): Schema.Schema.Type<typeof AnthropicServerToolUseBlock> => ({
  type: "server_tool_use",
  id: scrubToolCallID(part.id),
  name: part.name,
  input: part.input,
})

const serverToolResultType = (name: string): AnthropicServerToolResultType | undefined => {
  if (name === "web_search") return "web_search_tool_result"
  if (name === "code_execution") return "code_execution_tool_result"
  if (name === "web_fetch") return "web_fetch_tool_result"
  if (name === "tool_search_tool_regex" || name === "tool_search_tool_bm25") return "tool_search_tool_result"
  return undefined
}

export const lowerServerToolResult = Effect.fnUntraced(function* (part: ToolResultPart, providerMetadataKey: string) {
  const blockType = part.providerMetadata?.[providerMetadataKey]?.blockType
  const wireType = Schema.is(AnthropicServerToolResultType)(blockType) ? blockType : serverToolResultType(part.name)
  if (!wireType)
    return yield* ProviderShared.invalidRequest(
      `Anthropic Messages does not know how to round-trip server tool result for ${part.name}`,
    )
  // Prefer provider replay state, including when Core has converted the result to display content.
  const payload = part.providerMetadata?.[providerMetadataKey]?.["result"] ?? part.result.value
  return {
    type: wireType,
    tool_use_id: scrubToolCallID(part.id),
    content: payload,
  } satisfies Schema.Schema.Type<typeof AnthropicServerToolResultBlock>
})

const SERVER_TOOL_RESULT_NAMES: Record<AnthropicServerToolResultType, string> = {
  web_search_tool_result: "web_search",
  code_execution_tool_result: "code_execution",
  web_fetch_tool_result: "web_fetch",
  tool_search_tool_result: "tool_search_tool_regex",
}

export const isServerToolResultType = (type: string): type is AnthropicServerToolResultType =>
  type in SERVER_TOOL_RESULT_NAMES

export const serverToolResultEvent = (
  block: AnthropicStreamBlock,
  providerMetadataKey: string,
  serverToolNames: Readonly<Record<string, string>>,
): LLMEvent | undefined => {
  if (!block.type || !isServerToolResultType(block.type)) return undefined
  const errorPayload =
    ProviderShared.isRecord(block.content) && "type" in block.content ? String(block.content.type) : ""
  const isError = errorPayload.endsWith("_tool_result_error")
  return LLMEvent.toolResult({
    id: block.tool_use_id ?? "",
    name: serverToolNames[block.tool_use_id ?? ""] ?? SERVER_TOOL_RESULT_NAMES[block.type],
    result: isError ? { type: "error", value: block.content } : { type: "json", value: block.content },
    providerExecuted: true,
    providerMetadata: { [providerMetadataKey]: { blockType: block.type, result: block.content } },
  })
}
