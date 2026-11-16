import { expect, test } from "bun:test"
import { createOpenAI } from "@ai-sdk/openai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect } from "effect"
import { jsonSchema, streamText, type Tool } from "ai"
import { z } from "zod"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LLMRequestPrep } from "@/session/llm/request"
import { SessionID } from "@/session/schema"
import { SessionTools } from "@/session/tools"
import { ProviderTransform } from "@/provider/transform"

type Input = Parameters<typeof LLMRequestPrep.prepare>[0]
const schema = { type: "object" as const, properties: { path: { type: "string" as const } }, required: ["path"] }
const entries = Array.from({ length: 32 }, (_, index) => ({
  name: `lookup_${index}`,
  description: `Inspect service ${index}.`,
}))
const pluginSystem = "fixture plugin system"
const pluginInstructions = "fixture plugin instructions"
const catalog = z.array(z.object({ name: z.string(), description: z.string() }).strict())
const wire = z.object({
  instructions: z.string().optional(),
  input: z.array(z.object({ role: z.string(), content: z.unknown() })).optional(),
  system: z.array(z.object({ text: z.string() })).optional(),
  tools: z.array(z.record(z.string(), z.unknown())).default([]),
})

function fixture(provider: "openai" | "anthropic", mode: "deferred" | "eager" | "foreign" | "denied") {
  const options =
    mode === "eager"
      ? { openai: { deferLoading: false }, anthropic: { deferLoading: false } }
      : mode === "foreign"
        ? { [provider === "openai" ? "anthropic" : "openai"]: { deferLoading: true } }
        : SessionTools.deferLoading(undefined)
  const tools: Record<string, Tool> = Object.fromEntries(
    entries.map((entry) => [
      entry.name,
      {
        description: `  Inspect\tservice\n${entry.name.slice(7)}.\r\n \r\nHidden parameter details.`,
        inputSchema: jsonSchema(schema),
        providerOptions: options,
      },
    ]),
  )
  for (const name of ["agent_denied", "session_denied", "user_disabled"]) {
    tools[name] = { description: name, inputSchema: jsonSchema(schema), providerOptions: options }
  }
  tools.read = { description: "Read a file.", inputSchema: jsonSchema(schema) }
  tools.invalid = { description: "Internal repair handler.", inputSchema: jsonSchema(schema), providerOptions: options }
  tools.long_description = {
    description: "x".repeat(300),
    inputSchema: jsonSchema(schema),
    providerOptions: options,
  }
  tools.no_description = { inputSchema: jsonSchema(schema), providerOptions: options }
  tools.tool_search = {
    type: "provider",
    id: provider === "openai" ? "openai.tool_search" : "anthropic.tool_search_regex_20251119",
    args: {},
    inputSchema: jsonSchema({ type: "object", properties: {} }),
  }
  const providerID = ProviderV2.ID.make(provider)
  const modelID = ModelV2.ID.make(provider === "openai" ? "gpt-4.1" : "claude-sonnet-4-5")
  const sessionID = SessionID.make("ses_catalog")
  const input: Input = {
    sessionID,
    user: {
      id: SessionV1.MessageID.make("msg_catalog"),
      sessionID,
      role: "user",
      time: { created: 0 },
      agent: "catalog",
      model: { providerID, modelID },
      tools: { user_disabled: false },
    },
    model: {
      id: modelID,
      providerID,
      api: { id: modelID, url: "https://provider.invalid/v1", npm: `@ai-sdk/${provider}` },
      name: modelID,
      capabilities: {
        temperature: false,
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 128_000, output: 8_192 },
      status: "active",
      options: {},
      headers: {},
      release_date: "2026-01-01",
    },
    agent: {
      name: "catalog",
      mode: "primary",
      prompt: "fixture agent system",
      options: {},
      permission: [
        { permission: "*", pattern: "*", action: "allow" },
        { permission: "agent_denied", pattern: "*", action: "deny" },
      ],
    },
    permission: [{ permission: mode === "denied" ? "*" : "session_denied", pattern: "*", action: "deny" }],
    system: [],
    messages: [{ role: "user", content: "fixture user message" }],
    tools,
    provider: { id: providerID, name: provider, source: "config", env: [], options: {}, models: {} },
    auth: undefined,
    plugin: {
      trigger: (name, _input, output) => {
        if (typeof output === "object" && output !== null) {
          if (name === "experimental.chat.system.transform" && "system" in output && Array.isArray(output.system)) {
            output.system.splice(0, output.system.length, pluginSystem)
          }
          if (name === "chat.params" && "options" in output && typeof output.options === "object" && output.options) {
            Reflect.set(output.options, "instructions", pluginInstructions)
          }
        }
        return Effect.succeed(output)
      },
      list: () => Effect.succeed([]),
      init: () => Effect.void,
    },
    flags: Effect.runSync(RuntimeFlags.Service.pipe(Effect.provide(RuntimeFlags.layer()))),
    isWorkflow: false,
  }
  return input
}

for (const route of ["openai", "anthropic", "oauth"] as const) {
  for (const mode of ["deferred", "eager", "foreign", "denied"] as const) {
    test(`${route} wire exposes exactly the permitted catalog when tools are ${mode}`, async () => {
      const provider = route === "anthropic" ? "anthropic" : "openai"
      const input = fixture(provider, mode)
      const prepared = await Effect.runPromise(
        LLMRequestPrep.prepare({
          ...input,
          auth: route === "oauth" ? { type: "oauth", access: "fixture", refresh: "fixture", expires: 0 } : undefined,
        }),
      )
      const requests: unknown[] = []
      const stop = new Error("request captured")
      const fetch = Object.assign(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          requests.push(await new Request(url, init).json())
          throw stop
        },
        { preconnect: () => undefined },
      )
      const language =
        provider === "openai"
          ? createOpenAI({ apiKey: "fixture", fetch }).responses(input.model.api.id)
          : createAnthropic({ apiKey: "fixture", fetch })(input.model.api.id)
      const result = streamText({
        model: language,
        tools: prepared.tools,
        activeTools: prepared.activeTools,
        messages: prepared.messages,
        providerOptions: ProviderTransform.providerOptions(input.model, prepared.params.options),
        maxRetries: 0,
        onError: () => undefined,
      })
      const parts = await Array.fromAsync(result.fullStream)
      expect(parts.find((part) => part.type === "error")).toMatchObject({ error: stop })
      expect(requests).toHaveLength(1)
      const body = wire.parse(requests[0])
      expect(body.tools.some((tool) => tool.name === "invalid")).toBe(false)
      const context =
        route === "oauth"
          ? (body.instructions ?? "")
          : provider === "anthropic"
            ? (body.system?.map((part) => part.text).join("\n") ?? "")
            : (body.input
                ?.filter((part) => part.role === "system")
                .map((part) => part.content)
                .join("\n") ?? "")
      const blocks = [...context.matchAll(/<deferred_tools>\s*([\s\S]*?)\s*<\/deferred_tools>/g)]
      expect(blocks).toHaveLength(mode === "deferred" ? 1 : 0)
      if (mode === "deferred") {
        expect(catalog.parse(JSON.parse(blocks[0][1]))).toEqual(
          [
            ...entries,
            { name: "long_description", description: "x".repeat(240) },
            { name: "no_description", description: "" },
          ].toSorted((a, b) => a.name.localeCompare(b.name)),
        )
        expect(context).not.toContain("Hidden parameter details.")
        expect(context).not.toContain(JSON.stringify(schema))
      }
      if (route === "oauth") {
        expect(context.startsWith(pluginInstructions)).toBe(true)
        expect(body.input?.filter((part) => part.role === "system")).toEqual([])
      } else {
        expect(context.startsWith(pluginSystem)).toBe(true)
      }
      if (mode !== "denied") {
        expect(prepared.tools).toHaveProperty("invalid")
        expect(body.tools.find((tool) => tool.name === "read")).toMatchObject(
          provider === "openai" ? { parameters: schema } : { input_schema: schema },
        )
        expect(body.tools.find((tool) => tool.name === entries[0].name)?.defer_loading).toBe(
          mode === "deferred" ? true : mode === "eager" ? false : undefined,
        )
      }
      expect(Object.keys(prepared.tools)).not.toContain("agent_denied")
      expect(Object.keys(prepared.tools)).not.toContain("session_denied")
      expect(Object.keys(prepared.tools)).not.toContain("user_disabled")
    })
  }
}

test("an unsupported SDK never catalogs another SDK's deferred marks", async () => {
  const input = fixture("openai", "deferred")
  const prepared = await Effect.runPromise(
    LLMRequestPrep.prepare({
      ...input,
      model: { ...input.model, api: { ...input.model.api, npm: "@ai-sdk/openai-compatible" } },
    }),
  )
  expect(prepared.system).toEqual([pluginSystem])
})

test("Copilot keeps its compatibility tool callable when no registered tools remain", async () => {
  const input = fixture("openai", "eager")
  const prepared = await Effect.runPromise(
    LLMRequestPrep.prepare({
      ...input,
      tools: {},
      model: { ...input.model, providerID: ProviderV2.ID.make("github-copilot") },
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "call_fixture", toolName: "read", input: {} }],
        },
      ],
    }),
  )
  expect(prepared.activeTools).toEqual(["_noop"])
})
