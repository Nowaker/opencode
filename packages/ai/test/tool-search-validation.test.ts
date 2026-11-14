import { expect, test } from "bun:test"
import { Effect } from "effect"
import { ai, AIError, CacheHint, ToolNamespace } from "../src/effect.js"
import { Anthropic, Google, OpenAI, OpenAICompatibleResponses } from "../src/providers.js"
import { dynamicResponse } from "./lib/http.js"
import { anthropic, functionTool, openai } from "./lib/tool-search.js"

const invalid = [
  {
    name: "chat",
    model: OpenAI.configure({ apiKey: false }).chat("deployment"),
    tools: [functionTool(true)],
    tag: "UnsupportedOperation",
    message: "Tool deferral is not supported by",
  },
  {
    name: "generic Responses",
    model: OpenAICompatibleResponses.configure({
      provider: "fixture",
      apiKey: false,
      baseURL: "https://fixture.test",
    }).model("deployment"),
    tools: [functionTool(true)],
    tag: "UnsupportedOperation",
    message: "Tool deferral is not supported by",
  },
  {
    name: "Gemini",
    model: Google.configure({ apiKey: false }).model("deployment"),
    tools: [functionTool(true)],
    tag: "UnsupportedOperation",
    message: "Tool deferral is not supported by",
  },
  {
    name: "missing hosted search with eager ordinary search",
    model: openai,
    tools: [functionTool(true), { ...functionTool(), name: "tool_search" }],
    tag: "InvalidRequest",
    message: "requires exactly one hosted tool search descriptor",
  },
  {
    name: "fake search",
    model: openai,
    tools: [
      functionTool(true),
      { ...OpenAI.toolSearch(), native: { openai: { type: "tool_search", execution: "client" } } },
    ],
    tag: "InvalidRequest",
    message: "descriptor is malformed",
  },
  {
    name: "deferred search",
    model: openai,
    tools: [functionTool(true), { ...OpenAI.toolSearch(), deferred: true }],
    tag: "InvalidRequest",
    message: "descriptor is malformed",
  },
  {
    name: "malformed Anthropic name",
    model: anthropic,
    tools: [
      functionTool(true),
      {
        ...Anthropic.toolSearch(),
        native: { anthropic: { type: "tool_search_tool_regex_20251119", name: "tool_search_tool_bm25" } },
      },
    ],
    tag: "InvalidRequest",
    message: "descriptor is malformed",
  },
  {
    name: "conflicting searches",
    model: anthropic,
    tools: [functionTool(true), Anthropic.toolSearch(), Anthropic.toolSearch({ variant: "bm25" })],
    tag: "InvalidRequest",
    message: "requires exactly one hosted tool search descriptor",
  },
  {
    name: "conflicting function name",
    model: openai,
    tools: [functionTool(true), OpenAI.toolSearch(), { ...functionTool(), name: "tool_search" }],
    tag: "InvalidRequest",
    message: "Duplicate tool name",
  },
  {
    name: "deferred native tool",
    model: openai,
    tools: [OpenAI.toolSearch(), { ...OpenAI.imageGeneration(), deferred: true }],
    tag: "InvalidRequest",
    message: "Only ordinary function tools can be deferred",
  },
  {
    name: "deferred freeform",
    model: openai,
    tools: [
      OpenAI.toolSearch(),
      {
        ...functionTool(true),
        inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
        freeform: { type: "text" as const },
      },
    ],
    tag: "InvalidRequest",
    message: "Only ordinary function tools can be deferred",
  },
  {
    name: "nested deferred freeform",
    model: anthropic,
    tools: [
      Anthropic.toolSearch(),
      ToolNamespace.make({
        name: "catalog",
        tools: [{ ...functionTool(true), freeform: { type: "text" as const } }],
      }),
    ],
    tag: "InvalidRequest",
    message: "Only ordinary function tools can be deferred",
  },
  {
    name: "tools overlay",
    model: openai,
    tools: [OpenAI.toolSearch(), functionTool(true)],
    http: { body: { tools: [] } },
    tag: "InvalidRequest",
    message: "cannot be combined with an http.body.tools overlay",
  },
  {
    name: "Anthropic explicit cache hint",
    model: anthropic,
    tools: [Anthropic.toolSearch(), { ...functionTool(true), cache: new CacheHint({ type: "ephemeral" }) }],
    tag: "InvalidRequest",
    message: "cannot carry cache hints",
  },
] as const

test.each(invalid)("rejects $name before dispatch", async ({ model, tools, tag, message, ...options }) => {
  let dispatches = 0
  const result = await Effect.runPromise(
    ai.generate({ model, prompt: "hi", tools, ...options }).pipe(
      Effect.result,
      Effect.provide(
        dynamicResponse(() =>
          Effect.sync(() => {
            dispatches++
            throw new Error("Unexpected dispatch")
          }),
        ),
      ),
    ),
  )
  expect(result._tag).toBe("Failure")
  if (result._tag !== "Failure") throw new Error("Expected validation failure")
  expect(result.failure).toBeInstanceOf(AIError)
  expect(result.failure.reason._tag).toBe(tag)
  expect(result.failure.message).toContain(message)
  expect(dispatches).toBe(0)
})
