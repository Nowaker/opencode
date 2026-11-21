import { expect, test } from "bun:test"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { APICallError, generateText } from "ai"
import { AutoSwitchTranscript } from "@/session/auto-switch-transcript"
import { MessageID, PartID, SessionID } from "@/session/schema"

const claude = {
  providerID: ProviderV2.ID.make("anthropic-meridian"),
  modelID: ModelV2.ID.make("claude-opus-5-5"),
  variant: "max",
}
const gpt = {
  providerID: ProviderV2.ID.make("openai-meridian"),
  modelID: ModelV2.ID.make("gpt-6.2-sol"),
  variant: "xhigh",
}
const target = {
  providerID: gpt.providerID,
  api: { npm: "@ai-sdk/openai" },
  capabilities: { input: { text: true }, output: { text: true }, toolcall: true },
}
const claudeTarget = { ...target, providerID: claude.providerID, api: { npm: "@ai-sdk/anthropic" } }
const user = {
  role: "user",
  id: MessageID.make("msg_user"),
  sessionID: SessionID.make("ses_pilot"),
  time: { created: 1 },
  agent: "build",
  model: claude,
} satisfies SessionV1.User
const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
const assistant = {
  ...claude,
  role: "assistant",
  id: MessageID.make("msg_claude"),
  sessionID: user.sessionID,
  parentID: user.id,
  agent: user.agent,
  mode: user.agent,
  path: { cwd: "/fixture", root: "/fixture" },
  time: { created: 2, completed: 3 },
  cost: 0,
  tokens,
  finish: "tool-calls",
} satisfies SessionV1.Assistant

function base(messageID: MessageID, suffix: string) {
  return { id: PartID.make(`prt_${suffix}`), sessionID: user.sessionID, messageID }
}

const question = {
  info: user,
  parts: [{ ...base(user.id, "prompt"), type: "text", text: "Read the fixture and report its contents." }],
} satisfies SessionV1.WithParts
const call = {
  ...base(assistant.id, "read"),
  type: "tool",
  tool: "read",
  callID: "source_toolu_1234",
  state: {
    status: "completed",
    input: { filePath: "/fixture/example.txt" },
    title: "example.txt",
    metadata: {},
    output: "contents of example.txt",
    time: { start: 2, end: 3 },
  },
} satisfies SessionV1.ToolPart
const history = [
  question,
  {
    info: assistant,
    parts: [
      { ...base(assistant.id, "start"), type: "step-start", snapshot: "source_snapshot" },
      {
        ...base(assistant.id, "thinking"),
        type: "reasoning",
        text: "source_private_thinking",
        metadata: { anthropic: { signature: "source_signature" } },
        time: { start: 2, end: 3 },
      },
      {
        ...base(assistant.id, "text"),
        type: "text",
        text: "I'll read the fixture.",
        metadata: { anthropic: { cacheControl: { key: "source_cache" } } },
      },
      call,
    ],
  },
] satisfies SessionV1.WithParts[]

const nextUser = { ...user, id: MessageID.make("msg_next"), time: { created: 6 } }
const nextPrompt = { ...base(nextUser.id, "next"), type: "text", text: "Compare the two results." } as const
const gptAssistant = { ...assistant, ...gpt, id: MessageID.make("msg_gpt"), time: { created: 4, completed: 5 } }
const gptInput = { filePath: "/fixture/next.txt" }
const gptOutput = "contents of next.txt"
const gptStep = {
  info: gptAssistant,
  parts: [
    {
      ...base(gptAssistant.id, "gpt-thinking"),
      type: "reasoning",
      text: "gpt_private_reasoning",
      metadata: { openai: { itemId: "gpt_reasoning_id", reasoningEncryptedContent: "gpt_encrypted" } },
      time: { start: 4, end: 5 },
    },
    {
      ...call,
      ...base(gptAssistant.id, "gpt-read"),
      callID: "gpt_source_call_id",
      metadata: { openai: { itemId: "gpt_item_id" } },
      state: { ...call.state, input: gptInput, output: gptOutput, time: { start: 4, end: 5 } },
    },
  ],
} satisfies SessionV1.WithParts

test.each([
  { direction: "Claude Opus 5.5 to GPT-6.2 Sol xhigh", dialect: "openai", includeGPT: false },
  { direction: "sticky GPT-6.2 Sol xhigh", dialect: "openai", includeGPT: true },
  { direction: "GPT-6.2 Sol xhigh back to Claude Opus 5.5", dialect: "anthropic", includeGPT: true },
])("replays complete local tool history on the $direction wire", async (wire) => {
  const messages = wire.includeGPT ? [...history, gptStep, { info: nextUser, parts: [nextPrompt] }] : history
  const before = structuredClone(messages)
  const bodies: unknown[] = []
  const fetcher: typeof fetch = Object.assign(
    async (_: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json(
        { error: { message: "Fixture stops after serialization", type: "invalid_request_error" } },
        { status: 400 },
      )
    },
    { preconnect: fetch.preconnect },
  )
  const model =
    wire.dialect === "openai"
      ? createOpenAI({ apiKey: "fixture", fetch: fetcher }).responses(gpt.modelID)
      : createAnthropic({ apiKey: "fixture", fetch: fetcher })(claude.modelID)

  const projected = AutoSwitchTranscript.project({ messages, model: wire.dialect === "openai" ? target : claudeTarget })
  expect(projected.kind).toBe("projected")
  if (projected.kind !== "projected") return
  const providerOptions: Parameters<typeof generateText>[0]["providerOptions"] =
    wire.dialect === "openai"
      ? { openai: { store: false, reasoningEffort: gpt.variant } }
      : { anthropic: { thinking: { type: "adaptive" }, effort: claude.variant } }
  const response = generateText({ model, messages: projected.messages, maxRetries: 0, providerOptions })
  const status = await response.catch((error: unknown) => {
    if (APICallError.isInstance(error)) return error.statusCode
    throw error
  })
  expect(status).toBe(400)

  expect(bodies).toHaveLength(1)
  expect(JSON.stringify(bodies[0])).not.toMatch(
    /source_(?:toolu|signature|private|cache|snapshot)|gpt_(?:private|encrypted|reasoning_id|source_call_id|item_id)/,
  )
  expect(messages).toEqual(before)
  if (wire.dialect === "openai") {
    const args = JSON.stringify(call.state.input)
    expect(bodies[0]).toMatchObject({
      model: gpt.modelID,
      reasoning: { effort: "xhigh" },
      input: [
        { role: "user", content: [{ text: question.parts[0].text }] },
        { role: "assistant", content: [{ text: "I'll read the fixture." }] },
        { type: "function_call", name: "read", call_id: "call_portable_1", arguments: args },
        { type: "function_call_output", call_id: "call_portable_1", output: call.state.output },
        ...(wire.includeGPT
          ? [
              { type: "function_call", name: "read", call_id: "call_portable_2", arguments: JSON.stringify(gptInput) },
              { type: "function_call_output", call_id: "call_portable_2", output: gptOutput },
              { role: "user", content: [{ text: nextPrompt.text }] },
            ]
          : []),
      ],
    })
    return
  }
  const firstUse = { type: "tool_use", id: "call_portable_1", name: "read", input: call.state.input }
  const secondResult = { type: "tool_result", tool_use_id: "call_portable_2", content: gptOutput }
  expect(bodies[0]).toMatchObject({
    model: claude.modelID,
    thinking: { type: "adaptive" },
    messages: [
      { role: "user", content: [{ text: question.parts[0].text }] },
      { role: "assistant", content: [{ text: "I'll read the fixture." }, firstUse] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_portable_1", content: call.state.output }] },
      { role: "assistant", content: [{ type: "tool_use", id: "call_portable_2", name: "read", input: gptInput }] },
      { role: "user", content: [secondResult, { type: "text", text: nextPrompt.text }] },
    ],
  })
})

const file = { ...base(user.id, "file"), type: "file", mime: "image/png", url: "data:image/png;base64,AA==" } as const

test.each([
  ["user media", [{ info: user, parts: [...question.parts, file] }], "unsupported-media"],
  [
    "structured output",
    [{ ...question, info: { ...user, format: { type: "json_schema", schema: {}, retryCount: 2 } } }],
    "unsupported-output",
  ],
  [
    "compaction marker",
    [{ ...question, parts: [...question.parts, { ...base(user.id, "compact"), type: "compaction", auto: true }] }],
    "unsafe-history",
  ],
] satisfies [string, SessionV1.WithParts[], string][])("blocks %s instead of omitting it", (_, messages, reason) => {
  expect(AutoSwitchTranscript.project({ messages, model: target })).toMatchObject({ kind: "blocked", reason })
})

test.each([
  ["hosted", { ...call, metadata: { providerExecuted: true } }, "hosted-tool"],
  ["running", { ...call, state: { status: "running", input: {}, time: { start: 2 } } }, "incomplete-tool"],
  [
    "interrupted",
    {
      ...call,
      state: { ...call.state, status: "error", error: "Tool execution aborted", metadata: { interrupted: true } },
    },
    "incomplete-tool",
  ],
  ["cleared", { ...call, state: { ...call.state, time: { ...call.state.time, compacted: 4 } } }, "incomplete-tool"],
  ["attached media", { ...call, state: { ...call.state, attachments: [file] } }, "unsupported-media"],
  ["lost input", { ...call, state: { ...call.state, input: { filePath: undefined } } }, "incomplete-tool"],
] satisfies [string, SessionV1.ToolPart, string][])("blocks a %s tool record", (_, part, reason) => {
  const messages = [question, { info: assistant, parts: [part] }]
  expect(AutoSwitchTranscript.project({ messages, model: target })).toMatchObject({ kind: "blocked", reason })
})

test.each([target, claudeTarget])(
  "blocks open tool continuations requiring unsupported reasoning replay on $providerID",
  (model) => {
    const messages = [...history, gptStep]
    expect(AutoSwitchTranscript.project({ messages, model })).toEqual({ kind: "blocked", reason: "unsafe-history" })
  },
)

test("blocks unfinished visible text even if a step marker follows it", () => {
  const messages: SessionV1.WithParts[] = [
    question,
    {
      info: { ...assistant, time: { created: 2 } },
      parts: [
        { ...base(assistant.id, "partial"), type: "text", text: "Partial answer." },
        { ...base(assistant.id, "next-step"), type: "step-start" },
      ],
    },
    { info: nextUser, parts: [nextPrompt] },
  ]
  const result = AutoSwitchTranscript.project({ messages, model: target })
  expect(result).toEqual({ kind: "blocked", reason: "unsafe-history" })
})
