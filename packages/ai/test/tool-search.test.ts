import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { ai, AIError, CacheHint, Message, ToolDefinition, ToolNamespace } from "../src/effect.js"
import { Anthropic, Google, OpenAI, OpenAICompatibleResponses } from "../src/providers.js"
import { compileRequest } from "../src/testing.js"
import { dynamicResponse, fixedResponse } from "./lib/http.js"
import { sseEvents } from "./lib/sse.js"

const openai = OpenAI.configure({ apiKey: false }).responses("deployment")
const anthropic = Anthropic.configure({ apiKey: false }).model("deployment")
const functionTool = (deferred?: boolean) => ToolDefinition.make({
  name: "lookup", description: "Lookup", inputSchema: { type: "object", properties: {} }, deferred,
})

test.each([
  { name: "OpenAI", model: openai, search: OpenAI.toolSearch(), native: { type: "tool_search", execution: "server" } },
  { name: "Anthropic regex", model: anthropic, search: Anthropic.toolSearch(), native: { type: "tool_search_tool_regex_20251119", name: "tool_search_tool_regex" } },
  { name: "Anthropic BM25", model: anthropic, search: Anthropic.toolSearch({ variant: "bm25" }), native: { type: "tool_search_tool_bm25_20251119", name: "tool_search_tool_bm25" } },
])("declares full deferred functions and native search for $name", async ({ model, search, native }) => {
  const result = await Effect.runPromise(compileRequest(ai.request({
    model, prompt: "Find lookup", cache: "none", tools: [search, functionTool(true)],
  })))
  expect(result.body).toMatchObject({ tools: [native, { name: "lookup", defer_loading: true }] })
})

test("defers namespace leaves without deferring namespaces", async () => {
  const result = await Effect.runPromise(compileRequest(ai.request({
    model: openai, prompt: "Find lookup", tools: [OpenAI.toolSearch(), ToolNamespace.make({
      name: "catalog", tools: [ToolNamespace.make({ name: "nested", tools: [functionTool(true)] })],
    })],
  })))
  expect(result.body).toMatchObject({ tools: [
    { type: "tool_search", execution: "server" },
    { type: "namespace", name: "catalog", tools: [{ type: "function", name: "nested_lookup", defer_loading: true }] },
  ] })
  const tools = Schema.decodeUnknownSync(Schema.Struct({ tools: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) }))(result.body).tools
  expect(tools[1]).not.toHaveProperty("defer_loading")
})

test.each([undefined, false])("preserves eager wire output with deferred=%s", async (deferred) => {
  for (const model of [openai, anthropic]) {
    const plain = await Effect.runPromise(compileRequest(ai.request({ model, prompt: "hi", tools: [functionTool()] })))
    const selected = await Effect.runPromise(compileRequest(ai.request({ model, prompt: "hi", tools: [functionTool(deferred)] })))
    expect(selected.body).toEqual(plain.body)
    const tools = Schema.decodeUnknownSync(Schema.Struct({ tools: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) }))(selected.body).tools
    expect(tools[0]?.defer_loading).toBeUndefined()
  }
})

const invalid = [
  { name: "chat", model: OpenAI.configure({ apiKey: false }).chat("deployment"), tools: [functionTool(true)], tag: "UnsupportedOperation" },
  { name: "generic Responses", model: OpenAICompatibleResponses.configure({ provider: "fixture", apiKey: false, baseURL: "https://fixture.test" }).model("deployment"), tools: [functionTool(true)], tag: "UnsupportedOperation" },
  { name: "Gemini", model: Google.configure({ apiKey: false }).model("deployment"), tools: [functionTool(true)], tag: "UnsupportedOperation" },
  { name: "missing hosted search with eager ordinary search", model: openai, tools: [functionTool(true), { ...functionTool(), name: "tool_search" }], tag: "InvalidRequest" },
  { name: "fake search", model: openai, tools: [functionTool(true), { ...OpenAI.toolSearch(), native: { openai: { type: "tool_search", execution: "client" } } }], tag: "InvalidRequest" },
  { name: "deferred search", model: openai, tools: [functionTool(true), { ...OpenAI.toolSearch(), deferred: true }], tag: "InvalidRequest" },
  { name: "malformed Anthropic name", model: anthropic, tools: [functionTool(true), { ...Anthropic.toolSearch(), native: { anthropic: { type: "tool_search_tool_regex_20251119", name: "tool_search_tool_bm25" } } }], tag: "InvalidRequest" },
  { name: "conflicting searches", model: anthropic, tools: [functionTool(true), Anthropic.toolSearch(), Anthropic.toolSearch({ variant: "bm25" })], tag: "InvalidRequest" },
  { name: "conflicting function name", model: openai, tools: [functionTool(true), OpenAI.toolSearch(), { ...functionTool(), name: "tool_search" }], tag: "InvalidRequest" },
  { name: "deferred native tool", model: openai, tools: [OpenAI.toolSearch(), { ...OpenAI.imageGeneration(), deferred: true }], tag: "InvalidRequest" },
  { name: "deferred freeform", model: openai, tools: [OpenAI.toolSearch(), { ...functionTool(true), inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] }, freeform: { type: "text" as const } }], tag: "InvalidRequest" },
  { name: "nested deferred freeform", model: anthropic, tools: [Anthropic.toolSearch(), ToolNamespace.make({ name: "catalog", tools: [{ ...functionTool(true), freeform: { type: "text" as const } }] })], tag: "InvalidRequest" },
  { name: "tools overlay", model: openai, tools: [OpenAI.toolSearch(), functionTool(true)], http: { body: { tools: [] } }, tag: "InvalidRequest" },
  { name: "Anthropic explicit cache hint", model: anthropic, tools: [Anthropic.toolSearch(), { ...functionTool(true), cache: new CacheHint({ type: "ephemeral" }) }], tag: "InvalidRequest" },
]
test.each(invalid)("rejects $name before dispatch", async ({ model, tools, tag, ...options }) => {
  let dispatches = 0
  const result = await Effect.runPromise(ai.generate({ model, prompt: "hi", tools, ...options }).pipe(
    Effect.result,
    Effect.provide(dynamicResponse(() => Effect.sync(() => { dispatches++; throw new Error("Unexpected dispatch") }))),
  ))
  expect(result._tag).toBe("Failure")
  if (result._tag !== "Failure") throw new Error("Expected validation failure")
  expect(result.failure).toBeInstanceOf(AIError)
  expect(result.failure.reason._tag).toBe(tag)
  expect(result.failure.message).toContain(
    tag === "UnsupportedOperation" ? "Tool deferral is not supported by" :
    options.name === "fake search" || options.name === "deferred search" || options.name === "malformed Anthropic name" ? "descriptor is malformed" :
    options.name === "conflicting function name" ? "Duplicate tool name" :
    options.name.includes("freeform") || options.name === "deferred native tool" ? "Only ordinary function tools can be deferred" :
    options.name === "tools overlay" ? "cannot be combined with an http.body.tools overlay" :
    options.name === "Anthropic explicit cache hint" ? "cannot carry cache hints" : "requires exactly one hosted tool search descriptor",
  )
  expect(dispatches).toBe(0)
})

test("places automatic Anthropic cache hints before trailing deferred tools", async () => {
  const result = await Effect.runPromise(compileRequest(ai.request({
    model: anthropic, prompt: "hi", tools: [Anthropic.toolSearch(), functionTool(true)],
  })))
  expect(result.body).toMatchObject({ tools: [
    { type: "tool_search_tool_regex_20251119", cache_control: { type: "ephemeral" } },
    { name: "lookup", defer_loading: true },
  ] })
  const tools = Schema.decodeUnknownSync(Schema.Struct({ tools: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) }))(result.body).tools
  expect(tools[1]?.cache_control).toBeUndefined()
})

test.each(["regex", "bm25"] as const)("replays Anthropic %s references and error payloads exactly", async (variant) => {
  const name = `tool_search_tool_${variant}`
  const content = { type: "tool_search_tool_search_result", tool_references: [{ type: "tool_reference", tool_name: "lookup" }] }
  const error = { type: "tool_search_tool_result_error", error_code: "too_many_requests" }
  const blocks = [content, {}, error].flatMap((result, index) => [
    { type: "server_tool_use", id: `srv_${index}`, name, input: { query: "lookup" } },
    { type: "tool_search_tool_result", tool_use_id: `srv_${index}`, content: result },
  ])
  const frames = blocks.flatMap((block, index) => [
    { type: "content_block_start", index, content_block: block },
    { type: "content_block_stop", index },
  ])
  const response = await Effect.runPromise(ai.generate({ model: anthropic, prompt: "find" }).pipe(Effect.provide(fixedResponse(sseEvents(
    { type: "message_start", message: { id: "msg", usage: {} } }, ...frames,
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: {} }, { type: "message_stop" },
  )))))
  expect(response.message.content.filter((part) => part.type === "tool-result").map((part) => part.name)).toEqual([name, name, name])
  const replay = await Effect.runPromise(compileRequest(ai.request({ model: anthropic, messages: [Message.user("find"), response.message], cache: "none" })))
  expect(replay.body).toMatchObject({ messages: [{ role: "user" }, { role: "assistant", content: blocks }] })
})

test("keeps OpenAI object arguments, null call IDs and original native item IDs in ordered replay", async () => {
  const items = [
    { type: "tool_search_call", id: "native_call", call_id: null, execution: "server", status: "completed", arguments: { query: "lookup" } },
    { type: "tool_search_output", id: "native_output", call_id: null, execution: "server", status: "completed", tools: [{ type: "function", name: "lookup", parameters: {} }] },
  ]
  const frames = items.flatMap((item, output_index) => [
    { type: "response.output_item.added", output_index, item: { ...item, id: `normalized_${output_index}` } },
    { type: "response.output_item.done", output_index, item },
  ])
  const response = await Effect.runPromise(ai.generate({ model: openai, prompt: "find" }).pipe(Effect.provide(fixedResponse(sseEvents(
    ...frames, { type: "response.completed", response: { id: "response", status: "completed", output: items, usage: {} } },
  )))))
  expect(response.message.content.filter((part) => part.type === "tool-call").map((part) => part.id)).toEqual(["normalized_0", "normalized_1"])
  const replay = await Effect.runPromise(compileRequest(ai.request({ model: openai, messages: [response.message] })))
  expect(replay.body).toMatchObject({ input: items })
})

test.each([
  { type: "tool_search_call", id: "search_call", call_id: null, execution: "server", arguments: { query: "lookup" } },
  { type: "tool_search_output", id: "search_empty", call_id: null, execution: "server", tools: [] },
  { type: "tool_search_output", id: "search_error", call_id: null, execution: "server", tools: [], error: { code: "failed", detail: {} } },
])("replays directly constructed OpenAI search history for $id", async (item) => {
  const replay = await Effect.runPromise(compileRequest(ai.request({
    model: openai, messages: [Message.assistant({
      type: "tool-result", id: item.id, name: "tool_search", providerExecuted: true,
      result: { type: "json", value: item }, providerMetadata: { openai: { itemId: item.id } },
    })],
  })))
  expect(replay.body).toMatchObject({ input: [item] })
})
