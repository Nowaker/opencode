import { Effect, Schema } from "effect"
import type { AIError, LLMRequest, ToolDefinition } from "../../schema/index.js"
import type { ProviderAdapter } from "../open-responses.js"
import { OpenAIFreeform } from "../openai-freeform.js"
import { JsonObject, ProviderShared } from "../shared.js"

export const Tool = Schema.Struct({
  type: Schema.tag("function"),
  name: Schema.String,
  description: Schema.String,
  parameters: JsonObject,
  strict: Schema.optional(Schema.Boolean),
  defer_loading: Schema.optional(Schema.Boolean),
})

export const CustomTool = Schema.Struct({
  type: Schema.tag("custom"),
  name: Schema.String,
  description: Schema.String,
  format: Schema.Union([
    Schema.Struct({ type: Schema.tag("text") }),
    Schema.Struct({
      type: Schema.tag("grammar"),
      syntax: Schema.Literals(["lark", "regex"]),
      definition: Schema.String,
    }),
  ]),
})

export const HostedTool = Schema.StructWithRest(Schema.Struct({ type: Schema.String }), [JsonObject])
export type HostedTool = Schema.Schema.Type<typeof HostedTool>

const NamedTool = Schema.Struct({ type: Schema.Literals(["function", "custom"]), name: Schema.String })
export const ToolChoice = Schema.Union([
  Schema.Literals(["auto", "none", "required"]),
  NamedTool,
  Schema.Struct({
    type: Schema.tag("allowed_tools"),
    mode: Schema.Literals(["auto", "none", "required"]),
    tools: Schema.Array(NamedTool),
  }),
])

export const lowerTool = Effect.fnUntraced(function* (protocolName: string, tool: ToolDefinition) {
  if (tool.native !== undefined)
    return yield* ProviderShared.invalidRequest(`${protocolName} does not support provider-native tool ${tool.name}`)
  return {
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    // The common tool definition does not currently express Responses strict-schema policy.
    strict: false,
    ...(tool.deferred === true ? { defer_loading: true } : {}),
  }
})

export const lowerCustomTool = (tool: ToolDefinition, custom: OpenAIFreeform.Custom) => {
  const grammar = OpenAIFreeform.grammar(custom.format)
  return {
    type: "custom" as const,
    name: tool.name,
    description: tool.description,
    format: grammar ? { type: "grammar" as const, ...grammar } : { type: "text" as const },
  }
}

export const lowerTools = (
  tools: ReadonlyArray<ToolDefinition>,
  adapter: ProviderAdapter,
  custom: ReadonlyMap<string, OpenAIFreeform.Custom>,
) =>
  Effect.forEach(
    tools,
    (tool): Effect.Effect<Schema.Schema.Type<typeof Tool | typeof CustomTool> | HostedTool, AIError> => {
      if (tool.native !== undefined && adapter.nativeTool) return adapter.nativeTool(tool.native)
      const definition = custom.get(tool.name)
      return definition ? Effect.succeed(lowerCustomTool(tool, definition)) : lowerTool(adapter.name, tool)
    },
  )

export const namedTool = (name: string, custom: ReadonlyMap<string, OpenAIFreeform.Custom>) => ({
  type: custom.has(name) ? ("custom" as const) : ("function" as const),
  name,
})

export const lowerToolChoice = (
  protocolName: string,
  toolChoice: NonNullable<LLMRequest["toolChoice"]>,
  custom: ReadonlyMap<string, OpenAIFreeform.Custom>,
) =>
  ProviderShared.matchToolChoice(protocolName, toolChoice, {
    auto: () => "auto" as const,
    none: () => "none" as const,
    required: () => "required" as const,
    tool: (toolName) => namedTool(toolName, custom),
  })
