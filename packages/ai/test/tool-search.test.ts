import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { ai, ToolNamespace } from "../src/effect.js"
import { Anthropic, OpenAI } from "../src/providers.js"
import { compileRequest } from "../src/testing.js"
import { anthropic, functionTool, openai } from "./lib/tool-search.js"

test.each([
  { name: "OpenAI", model: openai, search: OpenAI.toolSearch(), native: { type: "tool_search", execution: "server" } },
  {
    name: "Anthropic regex",
    model: anthropic,
    search: Anthropic.toolSearch(),
    native: { type: "tool_search_tool_regex_20251119", name: "tool_search_tool_regex" },
  },
  {
    name: "Anthropic BM25",
    model: anthropic,
    search: Anthropic.toolSearch({ variant: "bm25" }),
    native: { type: "tool_search_tool_bm25_20251119", name: "tool_search_tool_bm25" },
  },
])("declares full deferred functions and native search for $name", async ({ model, search, native }) => {
  const result = await Effect.runPromise(
    compileRequest(ai.request({ model, prompt: "Find lookup", cache: "none", tools: [search, functionTool(true)] })),
  )
  expect(result.body).toMatchObject({ tools: [native, { name: "lookup", defer_loading: true }] })
})

test("defers namespace leaves without deferring namespaces", async () => {
  const result = await Effect.runPromise(
    compileRequest(
      ai.request({
        model: openai,
        prompt: "Find lookup",
        tools: [
          OpenAI.toolSearch(),
          ToolNamespace.make({
            name: "catalog",
            tools: [ToolNamespace.make({ name: "nested", tools: [functionTool(true)] })],
          }),
        ],
      }),
    ),
  )
  expect(result.body).toMatchObject({
    tools: [
      { type: "tool_search", execution: "server" },
      { type: "namespace", name: "catalog", tools: [{ type: "function", name: "nested_lookup", defer_loading: true }] },
    ],
  })
  const tools = Schema.decodeUnknownSync(
    Schema.Struct({ tools: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) }),
  )(result.body).tools
  expect(tools[1]).not.toHaveProperty("defer_loading")
})

test.each([undefined, false])("preserves eager wire output with deferred=%s", async (deferred) => {
  for (const model of [openai, anthropic]) {
    const plain = await Effect.runPromise(compileRequest(ai.request({ model, prompt: "hi", tools: [functionTool()] })))
    const selected = await Effect.runPromise(
      compileRequest(ai.request({ model, prompt: "hi", tools: [functionTool(deferred)] })),
    )
    expect(selected.body).toEqual(plain.body)
    const tools = Schema.decodeUnknownSync(
      Schema.Struct({ tools: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) }),
    )(selected.body).tools
    expect(tools[0]?.defer_loading).toBeUndefined()
  }
})

test("places automatic Anthropic cache hints before trailing deferred tools", async () => {
  const result = await Effect.runPromise(
    compileRequest(ai.request({ model: anthropic, prompt: "hi", tools: [Anthropic.toolSearch(), functionTool(true)] })),
  )
  expect(result.body).toMatchObject({
    tools: [
      { type: "tool_search_tool_regex_20251119", cache_control: { type: "ephemeral" } },
      { name: "lookup", defer_loading: true },
    ],
  })
  const tools = Schema.decodeUnknownSync(
    Schema.Struct({ tools: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) }),
  )(result.body).tools
  expect(tools[1]?.cache_control).toBeUndefined()
})
