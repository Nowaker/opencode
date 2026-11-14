import { Effect, Schema } from "effect"
import type { LLMRequest, ToolDefinition, ToolEntry } from "./schema/messages.js"
import { ProviderShared } from "./protocols/shared.js"

export const OpenAISearch = Schema.Struct({
  type: Schema.Literal("tool_search"),
  execution: Schema.Literal("server"),
})

export const AnthropicSearch = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("tool_search_tool_regex_20251119"),
    name: Schema.Literal("tool_search_tool_regex"),
  }),
  Schema.Struct({
    type: Schema.Literal("tool_search_tool_bm25_20251119"),
    name: Schema.Literal("tool_search_tool_bm25"),
  }),
])

const searchSlot = (tool: ToolDefinition) =>
  Object.values(tool.native ?? {}).some(
    (value) =>
      ProviderShared.isRecord(value) &&
      typeof value.type === "string" &&
      (value.type === "tool_search" || value.type.startsWith("tool_search_tool_")),
  )

export const validateToolSearch = Effect.fnUntraced(function* (request: LLMRequest) {
  const visit = (tools: ReadonlyArray<ToolEntry>): ToolDefinition[] =>
    tools.flatMap((tool) => (tool.type === "namespace" ? visit(tool.tools) : [tool]))
  const leaves = visit(request.tools)
  const deferred = leaves.filter((tool) => tool.deferred === true)
  const searches = leaves.filter(searchSlot)
  if (deferred.length === 0 && searches.length === 0) return
  const protocol = request.model.route.protocol
  if (protocol !== "openai-responses" && protocol !== "anthropic-messages")
    return yield* ProviderShared.unsupportedOperation({
      operation: "tool deferral",
      provider: request.model.provider,
      route: request.model.route.id,
      message: `Tool deferral is not supported by ${protocol}`,
    })
  if (request.http?.body && "tools" in request.http.body)
    return yield* ProviderShared.invalidRequest("Tool deferral cannot be combined with an http.body.tools overlay")
  if (searches.length !== 1)
    return yield* ProviderShared.invalidRequest("Tool deferral requires exactly one hosted tool search descriptor")
  const search = searches[0]
  const native = protocol === "openai-responses" ? search.native?.openai : search.native?.anthropic
  const valid =
    protocol === "openai-responses"
      ? Schema.is(OpenAISearch)(native) && search.name === "tool_search"
      : Schema.is(AnthropicSearch)(native) && search.name === native.name
  if (!valid || search.deferred === true || search.freeform !== undefined)
    return yield* ProviderShared.invalidRequest("Hosted tool search descriptor is malformed, deferred, or incompatible")
  if (!request.tools.includes(search))
    return yield* ProviderShared.invalidRequest("Hosted tool search must be a top-level tool")
  if (request.tools.some((tool) => tool !== search && tool.type === "tool" && tool.name === search.name))
    return yield* ProviderShared.invalidRequest("Hosted tool search conflicts with another tool name")
  for (const tool of deferred) {
    if (tool.native !== undefined || tool.freeform !== undefined)
      return yield* ProviderShared.invalidRequest(`Only ordinary function tools can be deferred: ${tool.name}`)
    if (protocol === "anthropic-messages" && tool.cache !== undefined)
      return yield* ProviderShared.invalidRequest(`Deferred Anthropic tools cannot carry cache hints: ${tool.name}`)
  }
})
