import { expect, test } from "bun:test"
import { jsonSchema, tool } from "ai"
import { AutoSwitchTranscript } from "@/session/auto-switch-transcript"

const request = {
  messages: [{ role: "user", content: "Read the fixture." }],
  system: ["Work in the fixture."],
  tools: { read: tool({ inputSchema: jsonSchema({ type: "object" }) }) },
  model: { limit: { context: 4_096, output: 4_096 }, capabilities: { toolcall: true } },
  maxOutputTokens: 128,
} satisfies Parameters<typeof AutoSwitchTranscript.checkBudget>[0]

test.each([
  ["large system instructions", { system: ["🧪".repeat(800)] }],
  [
    "large tool schema",
    { tools: { read: tool({ inputSchema: jsonSchema({ type: "object", description: "🧪".repeat(800) }) }) } },
  ],
  ["output reservation", { maxOutputTokens: 3_000 }],
  ["unknown output reservation", { maxOutputTokens: undefined }],
  ["smaller input limit", { model: { ...request.model, limit: { ...request.model.limit, input: 256 } } }],
] as const)("the context bound includes %s", async (_, override) => {
  expect(await AutoSwitchTranscript.checkBudget({ ...request, ...override })).toEqual({
    kind: "blocked",
    reason: "context-budget",
  })
})

test.each([
  ["previous response", { options: { previousResponseId: "fixture_response" } }, "unsafe-history"],
  ["automatic input truncation", { options: { truncation: "auto" } }, "unsafe-history"],
  ["Anthropic hosted MCP", { options: { mcpServers: [{ type: "url", name: "fixture" }] } }, "hosted-tool"],
  [
    "a deferred tool",
    { tools: { read: { ...request.tools.read, providerOptions: { openai: { deferLoading: true } } } } },
    "hosted-tool",
  ],
  [
    "a hosted tool",
    {
      tools: {
        tool_search: {
          type: "provider",
          id: "openai.tool_search",
          args: {},
          inputSchema: jsonSchema({ type: "object" }),
        },
      },
    },
    "hosted-tool",
  ],
  [
    "a model without tool calling",
    { model: { ...request.model, capabilities: { toolcall: false } } },
    "unsupported-tool",
  ],
] as const)("blocks %s before dispatch", async (_, override, reason) => {
  expect(await AutoSwitchTranscript.checkBudget({ ...request, ...override })).toEqual({ kind: "blocked", reason })
})

test("accepts a short text request with a local schema and reserved output", async () => {
  expect(await AutoSwitchTranscript.checkBudget(request)).toEqual({ kind: "fits" })
})
