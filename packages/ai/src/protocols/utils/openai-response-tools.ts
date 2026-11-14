import { Effect, Schema } from "effect"
import type { LLMRequest, ToolDefinition, ToolEntry } from "../../schema/index.js"
import { OpenAISearch } from "../../tool-search.js"
import { OpenAIFreeform } from "../openai-freeform.js"
import { ProviderShared } from "../shared.js"
import { Tool, CustomTool, ToolChoice, lowerTool, lowerCustomTool, namedTool } from "./open-responses-tools.js"

const NAME = "OpenAI Responses"
const ImageGenerationTool = Schema.Struct({
  type: Schema.tag("image_generation"),
  action: Schema.optional(Schema.Literals(["auto", "generate", "edit"])),
  background: Schema.optional(Schema.Literals(["auto", "opaque", "transparent"])),
  input_fidelity: Schema.optional(Schema.Literals(["low", "high"])),
  output_compression: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }))),
  output_format: Schema.optional(Schema.Literals(["png", "jpeg", "webp"])),
  partial_images: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  quality: Schema.optional(Schema.Literals(["auto", "low", "medium", "high"])),
  size: Schema.optional(
    Schema.String.check(
      Schema.makeFilter((value) => {
        if (value === "auto") return undefined
        const match = /^(\d+)x(\d+)$/.exec(value)
        if (!match) return "image size must be `auto` or `{width}x{height}`"
        return Number(match[1]) > 0 && Number(match[2]) > 0 ? undefined : "image dimensions must be positive integers"
      }),
    ),
  ),
})

const Namespace = Schema.Struct({
  type: Schema.tag("namespace"),
  name: Schema.String,
  description: Schema.String,
  tools: Schema.Array(Tool),
})

export const OpenAIResponsesTools = Schema.Union([Tool, CustomTool, Namespace, ImageGenerationTool, OpenAISearch])
export const OpenAIResponsesToolChoice = Schema.Union([
  ToolChoice,
  Schema.Struct({ type: Schema.tag("image_generation") }),
])

const nativeImageToolInput = (tool: ToolDefinition) => {
  const native = tool.native?.openai
  return ProviderShared.isRecord(native) && native.type === "image_generation" ? native : undefined
}

const nativeImageTool = (tool: ToolDefinition) => {
  const native = nativeImageToolInput(tool)
  return Schema.is(ImageGenerationTool)(native) ? native : undefined
}

const lowerDefinition = Effect.fnUntraced(function* (
  tool: ToolDefinition,
  custom: ReadonlyMap<string, OpenAIFreeform.Custom>,
) {
  if (Schema.is(OpenAISearch)(tool.native?.openai)) return tool.native.openai
  const native = nativeImageToolInput(tool)
  if (native !== undefined) {
    if (Schema.is(ImageGenerationTool)(native)) return native
    return yield* ProviderShared.invalidRequest("OpenAI Responses image generation tool options are invalid")
  }
  const definition = custom.get(tool.name)
  if (definition) return lowerCustomTool(tool, definition)
  return yield* lowerTool(NAME, tool)
})

// Native namespaces hold only function tools; deeper levels flatten to their leaf names.
const lowerEntry = Effect.fnUntraced(function* (tool: ToolEntry, custom: ReadonlyMap<string, OpenAIFreeform.Custom>) {
  if (tool.type === "tool") return yield* lowerDefinition(tool, custom)
  return {
    type: "namespace" as const,
    name: tool.name,
    description: tool.description ?? `Tools in the ${tool.name} namespace.`,
    tools: yield* Effect.forEach(ProviderShared.flattenTools(tool.tools), (leaf) => lowerTool(NAME, leaf)),
  }
})

export const lowerTools = (request: LLMRequest) => {
  const custom = OpenAIFreeform.tools(request)
  return Effect.forEach(request.tools, (tool) => lowerEntry(tool, custom))
}

export const lowerToolChoice = (
  toolChoice: NonNullable<LLMRequest["toolChoice"]>,
  tools: ReadonlyArray<ToolEntry>,
  custom: ReadonlyMap<string, OpenAIFreeform.Custom>,
) =>
  ProviderShared.matchToolChoice(NAME, toolChoice, {
    auto: () => "auto" as const,
    none: () => "none" as const,
    required: () => "required" as const,
    tool: (name) =>
      tools.some((tool) => tool.type === "tool" && tool.name === name && nativeImageTool(tool) !== undefined)
        ? ({ type: "image_generation" } as const)
        : namedTool(name, custom),
  })
