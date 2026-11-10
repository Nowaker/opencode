import { expect, test } from "bun:test"
import { Effect } from "effect"
import { jsonSchema, type Tool } from "ai"
import { LLMRequestPrep } from "@/session/llm/request"
import { SessionTools } from "@/session/tools"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"

const sessionID = "ses_llm-request-test"
const schema = jsonSchema({ type: "object", properties: {} })

// The request SessionTools.resolve builds for GPT when tool.deferral defers webfetch.
const tools = (): Record<string, Tool> => ({
  read: { description: "read a file", inputSchema: schema },
  webfetch: { description: "fetch a URL", inputSchema: schema, providerOptions: SessionTools.deferLoading(undefined) },
  [SessionTools.OPENAI_TOOL_SEARCH]: { type: "provider", id: "openai.tool_search", args: {}, inputSchema: schema },
})

const prepare = (permission: PermissionV1.Ruleset) =>
  Effect.runPromise(
    LLMRequestPrep.prepare({
      user: {
        id: "msg_user-test",
        sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: "explore",
        model: { providerID: "openai", modelID: "gpt-test" },
      } as any,
      sessionID,
      model: {
        id: "gpt-test",
        providerID: "openai",
        api: { id: "gpt-test", url: "https://api.openai.com/v1", npm: "@ai-sdk/openai" },
        capabilities: { temperature: false },
        options: {},
        limit: { context: 400_000, output: 128_000 },
        headers: {},
      } as any,
      agent: { name: "explore", mode: "subagent", options: {}, permission } as any,
      system: [],
      messages: [{ role: "user", content: "Hello" }],
      tools: tools(),
      provider: { id: "openai", options: {} } as any,
      auth: undefined,
      plugin: { trigger: (_name: string, _input: unknown, output: unknown) => Effect.succeed(output) } as any,
      flags: { outputTokenMax: 32_000, client: "test" } as any,
      isWorkflow: false,
    }),
  )

const deferred = (tools: Record<string, Tool>) =>
  Object.keys(tools).filter((id) => tools[id].providerOptions?.["openai"]?.["deferLoading"] === true)

test("an agent that denies every tool but a deferred one keeps the tool_search that loads it", async () => {
  // explore's shape: deny "*", then allow what it may use. OpenAI rejects deferred tools without tool_search.
  const result = await prepare([
    { permission: "*", action: "deny", pattern: "*" },
    { permission: "read", action: "allow", pattern: "*" },
    { permission: "webfetch", action: "allow", pattern: "*" },
  ])
  expect(deferred(result.tools)).toEqual(["webfetch"])
  expect(Object.keys(result.tools)).toContain(SessionTools.OPENAI_TOOL_SEARCH)
})

test("tool_search is dropped when no deferred tool is left", async () => {
  const result = await prepare([
    { permission: "*", action: "allow", pattern: "*" },
    { permission: "webfetch", action: "deny", pattern: "*" },
  ])
  expect(Object.keys(result.tools)).toEqual(["read"])
})
