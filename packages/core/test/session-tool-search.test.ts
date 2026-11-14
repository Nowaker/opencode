import { expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Database } from "@opencode/core/database/database"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionTable } from "@opencode/core/session/sql"
import { Tool } from "@opencode/core/tool"
import { Effect, Schema } from "effect"
import { testEffect } from "./lib/effect"
import { SearchFixture, searchLayer } from "./fixture/tool-search"

const openaiItems = [
  { type: "tool_search_call", id: "search_native", call_id: null, execution: "server", status: "completed", arguments: { query: "multiply" } },
  { type: "tool_search_output", id: "search_output_native", call_id: null, execution: "server", status: "completed", tools: [
    { type: "function", name: "multiply_alias", parameters: { type: "object", properties: { left: { type: "number" }, right: { type: "number" } } } },
  ] },
]
const anthropicBlocks = [
  { type: "server_tool_use", id: "search_native", name: "tool_search_tool_regex", input: { pattern: "multiply" } },
  { type: "tool_search_tool_result", tool_use_id: "search_native", content: {
    type: "tool_search_tool_search_result", tool_references: [{ type: "tool_reference", tool_name: "multiply_alias" }],
  } },
]
const sse = (frames: unknown[]) => frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")
const openaiReply = (step: number) => {
  const output = step === 1 ? [
    ...openaiItems,
    { type: "function_call", id: "function_native", call_id: "multiply_call", name: "multiply_alias", arguments: '{"left":13,"right":17}' },
  ] : [{ type: "message", id: `answer_${step}`, role: "assistant", content: [{ type: "output_text", text: "calculation settled" }] }]
  return sse([
    ...output.flatMap((item, output_index) => [
      { type: "response.output_item.added", output_index, item },
      { type: "response.output_item.done", output_index, item },
    ]),
    { type: "response.completed", response: { id: `response_${step}`, status: "completed", output, usage: { input_tokens: 12, output_tokens: 4 } } },
  ])
}
const anthropicReply = (step: number) => {
  const blocks = step === 1 ? [
    ...anthropicBlocks,
    { type: "tool_use", id: "multiply_call", name: "multiply_alias", input: { left: 13, right: 17 } },
  ] : [{ type: "text", text: "calculation settled" }]
  return sse([
    { type: "message_start", message: { id: `message_${step}`, usage: { input_tokens: 12 } } },
    ...blocks.flatMap((content_block, index) => [
      { type: "content_block_start", index, content_block }, { type: "content_block_stop", index },
    ]),
    { type: "message_delta", delta: { stop_reason: step === 1 ? "tool_use" : "end_turn" }, usage: { output_tokens: 4 } },
    { type: "message_stop" },
  ])
}

for (const protocol of ["openai", "anthropic"] as const) {
  testEffect(searchLayer(protocol, protocol === "openai" ? openaiReply : anthropicReply)).live(
    `${protocol} native Session executes a discovered deferred alias and replays stored provider search`,
    () => Effect.gen(function* () {
      const fixture = yield* SearchFixture
      const db = (yield* Database.Service).db
      const session = yield* Session.Service
      const agents = yield* Agent.Service
      yield* agents.transform((editor) => editor.update(Agent.defaultID, (agent) => { agent.mode = "primary" }))
      const tools = yield* Tool.Service
      const hooks = yield* PluginHooks.Service
      let executions = 0
      yield* tools.transform((editor) => editor.add({
        name: "multiply", description: "Multiply two integers", options: { codemode: false },
        input: Schema.Struct({ left: Schema.Int, right: Schema.Int }), output: Schema.Int,
        execute: ({ left, right }) => Effect.sync(() => {
          executions++
          return { output: left * right, content: `product=${left * right}` }
        }),
      }))
      yield* hooks.register("session", "context", (event) => Effect.gen(function* () {
        yield* Effect.yieldNow
        const tool = event.tools.multiply
        if (!tool) return yield* Effect.die("Missing multiply tool")
        tool.deferred = true
        event.tools.multiply_alias = tool
        delete event.tools.multiply
      }))
      const sessionID = Session.ID.create()
      yield* db.insert(ProjectTable).values({ id: Project.ID.global, worktree: AbsolutePath.make("/var/tmp"), sandboxes: [] }).run()
      yield* db.insert(SessionTable).values({ id: sessionID, project_id: Project.ID.global, slug: "tool-search", directory: "/var/tmp", title: "Tool search", version: "test" }).run()
      yield* session.prompt({ sessionID, text: "Find multiplication and compute 13 times 17", resume: false })
      yield* session.resume(sessionID)
      const stored = yield* session.context(sessionID)
      const toolRows = stored.flatMap((message) => message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [])
      expect(toolRows.filter((part) => part.executed).map((part) => part.name)).toEqual(
        protocol === "openai" ? ["tool_search", "tool_search"] : ["tool_search_tool_regex"],
      )
      expect(toolRows.find((part) => part.name === "multiply_alias")).toMatchObject({
        state: { status: "completed", content: [{ type: "text", text: "product=221" }] },
      })
      expect(executions).toBe(1)
      expect(fixture.bodies).toHaveLength(2)
      const catalog = Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String, Schema.Unknown)))(fixture.bodies[0]?.tools)
      expect(catalog.find((tool) => tool.name === "multiply_alias")).toMatchObject({ defer_loading: true, description: "Multiply two integers" })
      if (protocol === "openai") {
        const input = Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String, Schema.Unknown)))(fixture.bodies[1]?.input)
        expect(input.filter((item) => item.type === "tool_search_call" || item.type === "tool_search_output")).toEqual(openaiItems)
        expect(input.filter((item) => item.type === "function_call_output")).toEqual([{ type: "function_call_output", call_id: "multiply_call", output: "product=221" }])
        expect(fixture.bodies[1]).not.toHaveProperty("previous_response_id")
      }
      if (protocol === "anthropic") {
        const messages = Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String, Schema.Unknown)))(fixture.bodies[1]?.messages)
        expect(messages.find((message) => message.role === "assistant")?.content).toEqual([
          ...anthropicBlocks, { type: "tool_use", id: "multiply_call", name: "multiply_alias", input: { left: 13, right: 17 } },
        ])
        expect(messages.at(-1)?.content).toEqual([{ type: "tool_result", tool_use_id: "multiply_call", content: "product=221", cache_control: { type: "ephemeral" } }])
      }
      yield* session.prompt({ sessionID, text: "Continue from stored history", resume: false })
      yield* session.resume(sessionID)
      expect(executions).toBe(1)
      expect(fixture.bodies).toHaveLength(3)
      expect(JSON.stringify(fixture.bodies[2])).toContain(protocol === "openai" ? '"id":"search_output_native"' : '"type":"tool_reference"')
    }),
  )
}
