import { expect, test } from "bun:test"
import { Effect } from "effect"
import { ai, Message } from "../src/effect.js"
import { compileRequest } from "../src/testing.js"
import { fixedResponse } from "./lib/http.js"
import { sseEvents } from "./lib/sse.js"
import { anthropic, openai } from "./lib/tool-search.js"

test.each(["regex", "bm25"] as const)("replays Anthropic %s references and error payloads exactly", async (variant) => {
  const name = `tool_search_tool_${variant}`
  const content = {
    type: "tool_search_tool_search_result",
    tool_references: [{ type: "tool_reference", tool_name: "lookup" }],
  }
  const error = { type: "tool_search_tool_result_error", error_code: "too_many_requests" }
  const blocks = [content, {}, error].flatMap((result, index) => [
    { type: "server_tool_use", id: `srv_${index}`, name, input: { query: "lookup" } },
    { type: "tool_search_tool_result", tool_use_id: `srv_${index}`, content: result },
  ])
  const frames = blocks.flatMap((block, index) => [
    { type: "content_block_start", index, content_block: block },
    { type: "content_block_stop", index },
  ])
  const response = await Effect.runPromise(
    ai
      .generate({ model: anthropic, prompt: "find" })
      .pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "message_start", message: { id: "msg", usage: {} } },
              ...frames,
              { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: {} },
              { type: "message_stop" },
            ),
          ),
        ),
      ),
  )
  expect(response.message.content.filter((part) => part.type === "tool-result").map((part) => part.name)).toEqual([
    name,
    name,
    name,
  ])
  const replay = await Effect.runPromise(
    compileRequest(ai.request({ model: anthropic, messages: [Message.user("find"), response.message], cache: "none" })),
  )
  expect(replay.body).toMatchObject({ messages: [{ role: "user" }, { role: "assistant", content: blocks }] })
})

test("keeps OpenAI object arguments, null call IDs and original native item IDs in ordered replay", async () => {
  const items = [
    {
      type: "tool_search_call",
      id: "native_call",
      call_id: null,
      execution: "server",
      status: "completed",
      arguments: { query: "lookup" },
    },
    {
      type: "tool_search_output",
      id: "native_output",
      call_id: null,
      execution: "server",
      status: "completed",
      tools: [{ type: "function", name: "lookup", parameters: {} }],
    },
  ]
  const frames = items.flatMap((item, output_index) => [
    { type: "response.output_item.added", output_index, item: { ...item, id: `normalized_${output_index}` } },
    { type: "response.output_item.done", output_index, item },
  ])
  const response = await Effect.runPromise(
    ai.generate({ model: openai, prompt: "find" }).pipe(
      Effect.provide(
        fixedResponse(
          sseEvents(...frames, {
            type: "response.completed",
            response: { id: "response", status: "completed", output: items, usage: {} },
          }),
        ),
      ),
    ),
  )
  expect(response.message.content.filter((part) => part.type === "tool-call").map((part) => part.id)).toEqual([
    "normalized_0",
    "normalized_1",
  ])
  const replay = await Effect.runPromise(compileRequest(ai.request({ model: openai, messages: [response.message] })))
  expect(replay.body).toMatchObject({ input: items })
})

test.each([
  { type: "tool_search_call", id: "search_call", call_id: null, execution: "server", arguments: { query: "lookup" } },
  { type: "tool_search_output", id: "search_empty", call_id: null, execution: "server", tools: [] },
  {
    type: "tool_search_output",
    id: "search_error",
    call_id: null,
    execution: "server",
    tools: [],
    error: { code: "failed", detail: {} },
  },
])("replays directly constructed OpenAI search history for $id", async (item) => {
  const replay = await Effect.runPromise(
    compileRequest(
      ai.request({
        model: openai,
        messages: [
          Message.assistant({
            type: "tool-result",
            id: item.id,
            name: "tool_search",
            providerExecuted: true,
            result: { type: "json", value: item },
            providerMetadata: { openai: { itemId: item.id } },
          }),
        ],
      }),
    ),
  )
  expect(replay.body).toMatchObject({ input: [item] })
})
