import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { asSchema, type ImagePart, type ModelMessage, type TextPart, type Tool, type ToolCallPart, type ToolResultPart } from "ai"
import type { Provider } from "@/provider/provider"
import { isRecord } from "@/util/record"
import { inlineImage, inlineImageTokenReserve } from "./auto-switch-image"
import { MeridianRouting } from "@/provider/meridian-routing"

export type BlockReason =
  | "context-budget"
  | "hosted-tool"
  | "incomplete-tool"
  | "unsafe-history"
  | "unsupported-media"
  | "unsupported-output"
  | "unsupported-tool"
type Blocked = { readonly kind: "blocked"; readonly reason: BlockReason }

type ProjectionInput = {
  readonly messages: readonly SessionV1.WithParts[]
  readonly model: Pick<Provider.Model, "providerID"> & {
    readonly api: Pick<Provider.Model["api"], "npm">
    readonly capabilities: {
      readonly input: Pick<Provider.Model["capabilities"]["input"], "text"> & { readonly image?: boolean }
      readonly output: Pick<Provider.Model["capabilities"]["output"], "text">
      readonly toolcall: boolean
    }
  }
}

type BudgetInput = {
  readonly messages: readonly ModelMessage[]
  readonly system: readonly string[]
  readonly tools: Readonly<Record<string, Tool>>
  readonly model: Pick<Provider.Model, "limit"> & {
    readonly capabilities: Pick<Provider.Model["capabilities"], "toolcall">
  }
  readonly maxOutputTokens: number | undefined
  readonly options?: Readonly<Record<string, unknown>>
}

const blocked = (reason: BlockReason): Blocked => ({ kind: "blocked", reason })
const toolName = /^[A-Za-z0-9_-]{1,64}$/

// Keep this projection independent of destination identity. A mixed history
// uses the same portable representation on sticky GPT steps and manual return.
export function project(
  input: ProjectionInput,
): Blocked | { readonly kind: "projected"; readonly messages: ModelMessage[] } {
  const capabilities = input.model.capabilities
  const anthropic = input.model.api.npm === "@ai-sdk/anthropic"
  if (!anthropic && input.model.api.npm !== "@ai-sdk/openai") return blocked("unsafe-history")
  if (!capabilities.input.text || !capabilities.output.text) return blocked("unsupported-output")

  const messages: ModelMessage[] = []
  let callCount = 0
  let nativeReasoning = false
  let freshUser = false
  let lastToolWasForeign = false
  const destination = MeridianRouting.routeProvider(input.model.providerID)
  for (const message of input.messages) {
    const info = message.info
    const assistant = info.role === "assistant" ? info : undefined
    const origin = assistant && MeridianRouting.routeProvider(assistant.providerID)
    const settled = assistant && !assistant.error && assistant.time.completed !== undefined
    if (info.role === "user" && info.format?.type === "json_schema") return blocked("unsupported-output")
    if (assistant?.structured !== undefined) return blocked("unsupported-output")
    if (assistant?.summary) return blocked("unsafe-history")

    const seen = new Set<string>()
    const content: (TextPart | ToolCallPart)[] = []
    const userContent: (TextPart | ImagePart)[] = []
    const results: ToolResultPart[] = []
    const flush = () => {
      if (content.length) messages.push({ role: "assistant", content: content.splice(0) })
      if (results.length) messages.push({ role: "tool", content: results.splice(0) })
    }
    for (const part of message.parts) {
      switch (part.type) {
        case "text":
          if ((!assistant && part.ignored) || part.text === "") continue
          if (assistant && !settled) return blocked("unsafe-history")
          if (hasEvidence(part.metadata?.openai?.annotations) || hasEvidence(part.metadata?.anthropic?.citations)) {
            return blocked("unsafe-history")
          }
          const text = { type: "text", text: part.text } as const
          if (assistant) content.push(text)
          if (!assistant) userContent.push(text)
          continue
        case "reasoning":
          if (!settled || part.time.end === undefined) return blocked("unsafe-history")
          if (origin && origin === destination) nativeReasoning = true
          continue
        case "tool": {
          if (!assistant) return blocked("unsafe-history")
          const caller: unknown = part.metadata?.anthropic?.caller?.type
          if (
            part.metadata?.providerExecuted ||
            part.tool === "tool_search" ||
            (caller != null && caller !== "direct")
          ) {
            return blocked("hosted-tool")
          }
          if (!capabilities.toolcall || !toolName.test(part.tool) || part.metadata?.openai?.namespace != null) {
            return blocked("unsupported-tool")
          }
          if (typeof part.callID !== "string" || !part.callID || seen.has(part.callID))
            return blocked("incomplete-tool")
          if (
            part.state.status !== "completed" ||
            part.state.time.compacted !== undefined ||
            part.state.metadata?.truncated
          ) {
            return blocked("incomplete-tool")
          }
          if (part.state.attachments?.length) return blocked("unsupported-media")
          if (
            !settled ||
            typeof part.state.output !== "string" ||
            !isRecord(part.state.input) ||
            !isPortableJson(part.state.input)
          ) {
            return blocked("incomplete-tool")
          }
          seen.add(part.callID)
          lastToolWasForeign = !!origin && origin !== destination
          const toolCallId = `call_portable_${++callCount}`
          content.push({ type: "tool-call", toolName: part.tool, toolCallId, input: structuredClone(part.state.input) })
          results.push({
            type: "tool-result",
            toolName: part.tool,
            toolCallId,
            output: { type: "text", value: part.state.output },
          })
          continue
        }
        case "step-start":
          if (!assistant) return blocked("unsafe-history")
          flush()
          continue
        case "step-finish":
        case "patch":
        case "snapshot":
        case "retry":
          if (!settled) return blocked("unsafe-history")
          continue
        case "file": {
          const image = !assistant && capabilities.input.image && inlineImage(part)
          if (!image) return blocked("unsupported-media")
          userContent.push(image)
          continue
        }
        case "agent":
        case "compaction":
        case "subtask":
          return blocked("unsafe-history")
        default:
          return unknownPart(part)
      }
    }

    if (assistant) {
      flush()
      continue
    }
    if (!userContent.length) continue
    messages.push({ role: "user", content: userContent })
    freshUser = message.parts.some(
      (part) => part.type === "text" && !part.ignored && !part.synthetic && !!part.text.trim(),
    )
    if (freshUser) nativeReasoning = false
  }
  const first = messages[0]?.role
  const last = messages.at(-1)?.role
  if (first !== "user" || (last !== "user" && last !== "tool")) return blocked("unsafe-history")
  // An open native tool continuation may require the exact signed reasoning
  // or encrypted item. Claude return is only qualified after fresh user input.
  if (nativeReasoning || (anthropic && !(last === "user" ? freshUser : lastToolWasForeign))) return blocked("unsafe-history")
  return { kind: "projected", messages }
}

// Budget the prepared request, not the old provider's recorded tokens or just
// the new transcript. Count serialized UTF-8 bytes (one byte per token), with
// extra allowance for provider framing and separate tool-call JSON escaping.
export async function checkBudget(input: BudgetInput): Promise<Blocked | { readonly kind: "fits" }> {
  const limit = input.model.limit
  const output = input.maxOutputTokens
  if (
    !Number.isSafeInteger(limit.context) ||
    !Number.isSafeInteger(limit.output) ||
    (limit.input !== undefined && !Number.isSafeInteger(limit.input)) ||
    output === undefined ||
    !Number.isSafeInteger(output) ||
    output <= 0 ||
    output > limit.output
  ) {
    return blocked("context-budget")
  }
  const capacity = Math.min(limit.context - output, limit.input ?? limit.context)
  if (capacity <= 0) return blocked("context-budget")

  const options = input.options
  if (options?.mcpServers != null || options?.container != null) return blocked("hosted-tool")
  if (
    options?.previousResponseId != null ||
    options?.conversation != null ||
    options?.truncation === "auto" ||
    options?.contextManagement != null ||
    options?.systemMessageMode === "remove" ||
    (isRecord(options?.thinking) && options.thinking.type === "enabled")
  ) {
    return blocked("unsafe-history")
  }

  try {
    let remaining = capacity - 1024
    remaining -= Buffer.byteLength(JSON.stringify(input.system))
    remaining -= Buffer.byteLength(JSON.stringify(options ?? {}))
    for (const message of input.messages) {
      remaining -= 32 + Buffer.byteLength(JSON.stringify(message))
      if (typeof message.content !== "string") {
        for (const part of message.content) {
          remaining -= 32
          if (part.type === "image") remaining -= inlineImageTokenReserve
          if (part.type === "tool-call") remaining -= Buffer.byteLength(JSON.stringify(JSON.stringify(part.input)))
        }
      }
      if (remaining < 0) return blocked("context-budget")
    }
    for (const [name, tool] of Object.entries(input.tools)) {
      if (tool.type === "provider" || Object.values(tool.providerOptions ?? {}).some((value) => value.deferLoading)) {
        return blocked("hosted-tool")
      }
      if (!input.model.capabilities.toolcall || !toolName.test(name)) return blocked("unsupported-tool")
      const schema = await asSchema(tool.inputSchema).jsonSchema
      remaining -=
        64 +
        Buffer.byteLength(
          JSON.stringify({ name, description: tool.description, schema, options: tool.providerOptions }),
        )
      if (remaining < 0) return blocked("context-budget")
    }
    return remaining >= 0 ? { kind: "fits" } : blocked("context-budget")
  } catch (error) {
    if (error instanceof Error) return blocked("context-budget")
    throw error
  }
}

function unknownPart(_part: never): Blocked {
  return blocked("unsafe-history")
}

function hasEvidence(value: unknown) {
  return value != null && !(Array.isArray(value) && value.length === 0)
}

function isPortableJson(value: unknown, depth = 0): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0)
  if (depth > 64 || typeof value !== "object" || value === null) return false
  if (Array.isArray(value)) {
    return (
      Object.keys(value).length === value.length && Array.from(value).every((item) => isPortableJson(item, depth + 1))
    )
  }
  const prototype = Object.getPrototypeOf(value)
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.values(value).every((item) => isPortableJson(item, depth + 1))
  )
}

export * as AutoSwitchTranscript from "./auto-switch-transcript"
