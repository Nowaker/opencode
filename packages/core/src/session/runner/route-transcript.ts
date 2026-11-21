import type { LLMRequest } from "@opencode/ai/effect"
import { Message } from "@opencode/ai/effect"
import { createHash } from "node:crypto"
import { Effect } from "effect"
import type { SessionContext } from "../context.js"
import { SessionCompaction } from "../compaction.js"
import { SessionHistory } from "../history.js"
import { SessionModelRequest } from "../model-request.js"
import { MAX_STEPS_PROMPT } from "./max-steps.js"

export const prepare = Effect.fnUntraced(function* (input: {
  readonly context: SessionContext.Interface
  readonly loaded: SessionContext.Loaded
  readonly step: number
  readonly portable: boolean
  readonly http: boolean
}) {
  const { loaded } = input
  const messages = input.portable ? portableHistory(loaded) : loaded.messages
  if (!messages) return
  const transcript = SessionModelRequest.baseTranscript({ ...loaded, agent: loaded.agent.info, messages })
  const stepLimitReached = loaded.agent.info.steps !== undefined && input.step >= loaded.agent.info.steps
  const estimate = input.portable
    ? { measured: 0, estimated: SessionCompaction.estimateRequest({ ...transcript, tools: loaded.tools.definitions }) }
    : SessionCompaction.estimatePrompt(loaded)
  const requested = stepLimitReached
    ? [...transcript.messages, Message.assistant(MAX_STEPS_PROMPT)]
    : transcript.messages
  const expected = input.portable ? fingerprint(requested) : undefined
  const prepared = yield* input.context.request.primary({
    session: loaded.session,
    agent: loaded.agent.id,
    model: loaded.model,
    tools: loaded.tools,
    system: transcript.system,
    messages: requested,
    toolChoice: stepLimitReached ? "none" : undefined,
    webSocket: input.http ? undefined : "session",
    inputTokens: estimate,
  })
  if (input.portable && (expected !== fingerprint(prepared.event.messages) || !fits(prepared, loaded))) return
  return {
    request: prepared.request,
    options: prepared.options,
    retry: prepared.retry,
    executeTool: prepared.executeTool,
  }
})

function fingerprint(messages: LLMRequest["messages"]) {
  const hash = createHash("sha256")
  for (const message of messages) hash.update(JSON.stringify(message))
  return hash.digest("hex")
}

function portableHistory(loaded: SessionContext.Loaded) {
  const provider = loaded.model.ref.providerID
  for (const row of loaded.messages) {
    if (SessionHistory.isNativeCompaction(row)) return undefined
    if (
      row.type === "user" &&
      row.files?.some(
        (file) =>
          ![
            "text/plain",
            "application/x-directory",
            "application/pdf",
            "image/png",
            "image/jpeg",
            "image/gif",
            "image/webp",
          ].includes(file.mime),
      )
    )
      return undefined
    if (row.type !== "assistant") continue
    if (row.time.completed === undefined) return undefined
    for (const part of row.content) {
      if (part.type !== "tool") continue
      if (part.state.status !== "completed" && part.state.status !== "error") return undefined
      if (row.model.providerID !== provider && part.executed) return undefined
      if (part.state.content?.some((item) => item.type === "file" && !item.uri.startsWith("data:"))) return undefined
    }
  }
  return loaded.messages.map((row) =>
    row.type === "assistant" && row.model.providerID !== provider
      ? { ...row, content: row.content.filter((part) => part.type !== "reasoning") }
      : row,
  )
}

function fits(prepared: SessionModelRequest.Prepared, loaded: SessionContext.Loaded) {
  const { request } = prepared
  const limit = loaded.model.limit
  if (request.http?.body && Object.keys(request.http.body).length > 0) return false
  if (!loaded.model.capabilities.output.includes("text")) return false
  if (
    !loaded.model.capabilities.tools &&
    (request.tools.length > 0 || request.messages.some((row) => row.role === "tool"))
  )
    return false
  if (prepared.mediaPreserved !== true) return false
  if (!completeToolPairs(request)) return false
  const estimated = Math.ceil(SessionCompaction.estimateRequest(request) * 1.2)
  const output = request.maxTokens ?? limit.output
  return (
    limit.context > 0 &&
    output > 0 &&
    output <= limit.output &&
    estimated <= (limit.input ?? limit.context) &&
    estimated + output <= limit.context
  )
}

function completeToolPairs(request: LLMRequest) {
  const open = new Map<string, string>()
  const seen = new Set<string>()
  for (const row of request.messages) {
    if (open.size && row.role !== "tool") return false
    for (const part of row.content) {
      if (part.type === "media" && part.media.source.type !== "base64" && part.media.source.type !== "bytes")
        return false
      if (part.type === "compaction") return false
      if (part.type !== "tool-call" && part.type !== "tool-result") continue
      if (part.providerExecuted || !/^[a-zA-Z0-9_-]+$/.test(part.id)) return false
      if (part.type === "tool-call") {
        if (seen.has(part.id)) return false
        seen.add(part.id)
        open.set(part.id, part.name)
        continue
      }
      if (open.get(part.id) !== part.name) return false
      open.delete(part.id)
    }
  }
  return open.size === 0
}
