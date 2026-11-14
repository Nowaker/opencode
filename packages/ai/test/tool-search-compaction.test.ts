import { expect, test } from "bun:test"
import { Effect } from "effect"
import { ai, AIError, type LLMRequest } from "../src/effect.js"
import { OpenAI } from "../src/providers.js"
import { dynamicResponse } from "./lib/http.js"
import { sseEvents } from "./lib/sse.js"
import { functionTool, openai } from "./lib/tool-search.js"

const checkpoint = { type: "compaction", id: "cmp_tools", encrypted_content: "tool-search-context" } as const
const mechanisms = [
  {
    mechanism: "endpoint",
    contentType: "application/json",
    response: JSON.stringify({ object: "response.compaction", output: [checkpoint] }),
  },
  {
    mechanism: "trigger",
    contentType: "text/event-stream",
    response: sseEvents(
      { type: "response.output_item.done", item: checkpoint },
      { type: "response.completed", response: { id: "resp_tools", status: "completed", output: [checkpoint] } },
    ),
  },
] as const

const invalid = [
  {
    name: "missing hosted search",
    tools: [functionTool(true)],
    http: undefined,
    message: "requires exactly one hosted tool search descriptor",
  },
  {
    name: "tools overlay",
    tools: [OpenAI.toolSearch(), functionTool(true)],
    http: { body: { tools: [] } },
    message: "cannot be combined with an http.body.tools overlay",
  },
] as const

const compact = (request: LLMRequest & { readonly model: typeof openai }, mechanism: "endpoint" | "trigger") =>
  ({
    endpoint: ai.compact(request).pipe(Effect.asVoid),
    trigger: ai.compact(request, { mechanism: "trigger" }).pipe(Effect.asVoid),
  })[mechanism]

for (const method of mechanisms) {
  test.each(invalid)(
    `${method.mechanism} rejects $name before compaction dispatch`,
    async ({ tools, http, message }) => {
      let dispatches = 0
      const result = await Effect.runPromise(
        compact(ai.request({ model: openai, prompt: "find", tools, http }), method.mechanism).pipe(
          Effect.result,
          Effect.provide(
            dynamicResponse(({ respond }) =>
              Effect.sync(() => {
                dispatches++
                return respond(method.response, { headers: { "content-type": method.contentType } })
              }),
            ),
          ),
        ),
      )
      expect(result._tag).toBe("Failure")
      if (result._tag !== "Failure") throw new Error("Expected tool-deferral refusal")
      expect(result.failure).toBeInstanceOf(AIError)
      expect(result.failure.reason._tag).toBe("InvalidRequest")
      expect(result.failure.message).toContain(message)
      expect(dispatches).toBe(0)
    },
  )

  test(`${method.mechanism} compacts a valid deferred request once`, async () => {
    let dispatches = 0
    const result = await Effect.runPromise(
      compact(
        ai.request({ model: openai, prompt: "find", tools: [OpenAI.toolSearch(), functionTool(true)] }),
        method.mechanism,
      ).pipe(
        Effect.result,
        Effect.provide(
          dynamicResponse(({ respond }) =>
            Effect.sync(() => {
              dispatches++
              return respond(method.response, { headers: { "content-type": method.contentType } })
            }),
          ),
        ),
      ),
    )
    expect(result._tag).toBe("Success")
    expect(dispatches).toBe(1)
  })
}
