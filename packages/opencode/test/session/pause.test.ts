import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { EventV2Bridge } from "@/event-v2-bridge"
import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import path from "path"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { Command } from "../../src/command"
import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Env } from "../../src/env"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"
import { Question } from "../../src/question"
import { Todo } from "../../src/session/todo"
import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionSummary } from "../../src/session/summary"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionPause } from "../../src/session/pause"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { MessageID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Format } from "../../src/format"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { TestInstance } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceStore } from "@/project/instance-store"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    instructions: () => Effect.succeed([]),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    resourceTemplates: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth"),
    authenticate: () => Effect.die("unexpected MCP auth"),
    finishAuth: () => Effect.die("unexpected MCP auth"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const root = LayerNode.group([
  SessionPrompt.node,
  SessionPause.node,
  Session.node,
  SessionProjector.node,
  MessageV2.node,
  LLM.node,
  Env.node,
  AgentSvc.node,
  Command.node,
  Permission.node,
  Plugin.node,
  Config.node,
  ProviderSvc.node,
  LSP.node,
  MCP.node,
  FSUtil.node,
  BackgroundJob.node,
  SessionStatus.node,
  SessionRunState.node,
  Database.node,
  EventV2Bridge.node,
  Question.node,
  Todo.node,
  ToolRegistry.node,
  Skill.node,
  Git.node,
  Ripgrep.node,
  Format.node,
  Truncate.node,
  SessionProcessor.node,
  Image.node,
  SessionCompaction.node,
  SessionRevert.node,
  Instruction.node,
  SystemPrompt.node,
  CrossSpawnSpawner.node,
  RuntimeFlags.node,
  LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
])

const it = testEffect(
  LayerNode.compile(root, [
    [SessionSummary.node, summary],
    [LSP.node, lsp],
    [MCP.node, mcp],
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
  ]),
)

const ref = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") }
const allowAll = [{ permission: "*", pattern: "*", action: "allow" as const }]

const setup = Effect.fn("test.setup")(function* (config?: Partial<ConfigV1.Info>) {
  const { directory } = yield* TestInstance
  const llm = yield* TestLLMServer
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(
    path.join(directory, "opencode.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      provider: {
        test: {
          name: "Test",
          id: "test",
          env: [],
          npm: "@ai-sdk/openai-compatible",
          models: {
            "test-model": {
              id: "test-model",
              name: "Test Model",
              attachment: false,
              reasoning: false,
              temperature: false,
              tool_call: true,
              release_date: "2025-01-01",
              limit: { context: 100000, output: 10000 },
              cost: { input: 0, output: 0 },
              options: {},
            },
          },
          options: { apiKey: "test-key", baseURL: llm.url },
        },
      },
      ...config,
    }),
  )
  const sessions = yield* Session.Service
  const chat = yield* sessions.create({ title: "Pause", permission: allowAll })
  return { directory, llm, chat, sessions, prompt: yield* SessionPrompt.Service, pauses: yield* SessionPause.Service }
})

const text = (sessionID: SessionID, value: string, extra?: Partial<SessionPrompt.PromptInput>) => ({
  sessionID,
  messageID: MessageID.ascending(),
  agent: "build",
  model: ref,
  parts: [{ type: "text" as const, text: value }],
  ...extra,
})

const toolParts = (messages: SessionV1.WithParts[]) =>
  messages.flatMap((msg) => msg.parts.filter((part): part is SessionV1.ToolPart => part.type === "tool"))

const idle = (sessionID: SessionID) =>
  pollWithTimeout(
    Effect.gen(function* () {
      const status = yield* SessionStatus.Service
      return (yield* status.get(sessionID)).type === "idle" ? true : undefined
    }),
    `session ${sessionID} never became idle`,
    "10 seconds",
  )

/*
 * A turn whose first response asks for three tool calls, paused while that response streams. Returns once the
 * turn has stopped at the step boundary with the three calls deferred.
 */
const pausedWithThreeCalls = Effect.fn("test.pausedWithThreeCalls")(function* () {
  const ctx = yield* setup()
  const file = path.join(ctx.directory, "notes.txt")
  yield* (yield* FSUtil.Service).writeWithDirs(file, "read me words")
  const gate = yield* Deferred.make<void>()
  yield* ctx.llm.push(
    reply()
      .wait(Effect.runPromise(Deferred.await(gate)))
      .text("I will run three tools")
      .tool("bash", { command: "printf '%s-%s' one output", description: "one" })
      .tool("read", { filePath: file })
      .tool("bash", { command: "printf '%s-%s' three output", description: "three" }),
  )
  const turn = yield* ctx.prompt.prompt(text(ctx.chat.id, "do the work")).pipe(Effect.forkChild)
  yield* ctx.llm.wait(1)
  const paused = yield* ctx.prompt.pause({ sessionID: ctx.chat.id, source: { kind: "tui" }, reason: "testing" })
  expect(paused.changed).toBe(true)
  expect(paused.pause.state).toBe("pending")
  yield* Deferred.succeed(gate, undefined)
  yield* Fiber.join(turn)
  return { ...ctx, file }
})

it.instance(
  "a pause while the response streams defers its tool calls and stops at the step boundary; unpause runs them in order",
  () =>
    Effect.gen(function* () {
      const ctx = yield* pausedWithThreeCalls()
      expect(yield* ctx.llm.calls).toBe(1)

      const messages = yield* ctx.sessions.messages({ sessionID: ctx.chat.id })
      const deferred = toolParts(messages)
      expect(deferred.map((part) => part.state.status)).toEqual(["pending", "pending", "pending"])
      expect(deferred.every((part) => SessionPause.isDeferred(part))).toBe(true)
      expect(deferred[0].state.input).toEqual({ command: "printf '%s-%s' one output", description: "one" })
      const assistant = messages.findLast((msg) => msg.info.role === "assistant")?.info
      expect(assistant?.role === "assistant" && assistant.finish).toBe("tool-calls")
      expect(assistant?.role === "assistant" && assistant.error).toBeUndefined()

      const pause = yield* ctx.pauses.get(ctx.chat.id)
      expect(pause?.state).toBe("paused")
      expect(pause?.stoppedAt).toBeNumber()
      expect(pause?.reason).toBe("testing")
      expect((yield* (yield* SessionStatus.Service).get(ctx.chat.id)).paused?.state).toBe("paused")

      // Nothing wakes a paused session: a loop finds the pause and starts no model request.
      yield* ctx.prompt.loop({ sessionID: ctx.chat.id })
      expect(yield* ctx.llm.calls).toBe(1)

      yield* ctx.llm.text("all three ran")
      const result = yield* ctx.prompt.unpause({ sessionID: ctx.chat.id, source: { kind: "tui" } })
      expect(result).toEqual({ sessionID: ctx.chat.id, changed: true, deferred: 3 })
      yield* ctx.llm.wait(2)
      yield* idle(ctx.chat.id)
      expect(yield* ctx.llm.calls).toBe(2)
      expect(yield* ctx.pauses.get(ctx.chat.id)).toBeUndefined()

      const ran = toolParts(yield* ctx.sessions.messages({ sessionID: ctx.chat.id }))
      expect(ran.map((part) => part.state.status)).toEqual(["completed", "completed", "completed"])
      const starts = ran.map((part) => (part.state.status === "completed" ? part.state.time.start : 0))
      expect(starts).toEqual([...starts].sort((a, b) => a - b))
      const body = JSON.stringify((yield* ctx.llm.inputs)[1])
      expect(body.indexOf("one-output")).toBeGreaterThan(-1)
      expect(body.indexOf("read me words")).toBeGreaterThan(body.indexOf("one-output"))
      expect(body.indexOf("three-output")).toBeGreaterThan(body.indexOf("read me words"))

      const notices = (yield* ctx.sessions.messages({ sessionID: ctx.chat.id })).flatMap((msg) =>
        msg.parts.filter((part) => part.type === "text" && part.ignored),
      )
      expect(notices.map((part) => part.type === "text" && part.metadata?.pause?.action)).toEqual(["pause", "unpause"])
      expect(body).not.toContain("call: /pause")
    }),
  { git: true },
  60_000,
)

it.instance(
  "a tool already running when the pause comes finishes, a second pause changes nothing, and no model request follows",
  () =>
    Effect.gen(function* () {
      const ctx = yield* setup()
      const marker = path.join(ctx.directory, "release")
      yield* ctx.llm.tool("bash", {
        command: `while [ ! -f '${marker}' ]; do sleep 0.01; done; echo ran-to-the-end`,
        description: "wait",
      })
      const turn = yield* ctx.prompt.prompt(text(ctx.chat.id, "run it")).pipe(Effect.forkChild)
      yield* pollWithTimeout(
        ctx.sessions
          .messages({ sessionID: ctx.chat.id })
          .pipe(Effect.map((messages) => (toolParts(messages)[0]?.state.status === "running" ? true : undefined))),
        "the tool never started",
        "10 seconds",
      )
      expect((yield* ctx.prompt.pause({ sessionID: ctx.chat.id })).pause.state).toBe("pending")
      expect((yield* ctx.prompt.pause({ sessionID: ctx.chat.id })).changed).toBe(false)
      expect((yield* (yield* SessionStatus.Service).get(ctx.chat.id)).type).toBe("busy")
      yield* (yield* FSUtil.Service).writeWithDirs(marker, "")
      yield* Fiber.join(turn)

      expect(yield* ctx.llm.calls).toBe(1)
      const part = toolParts(yield* ctx.sessions.messages({ sessionID: ctx.chat.id }))[0]
      expect(part.state.status).toBe("completed")
      expect(part.state.status === "completed" && part.state.output).toContain("ran-to-the-end")
      expect((yield* ctx.pauses.get(ctx.chat.id))?.state).toBe("paused")

      yield* ctx.llm.text("done")
      expect((yield* ctx.prompt.unpause({ sessionID: ctx.chat.id })).deferred).toBe(0)
      yield* ctx.llm.wait(2)
      yield* idle(ctx.chat.id)
      expect(yield* ctx.llm.calls).toBe(2)
    }),
  { git: true },
  60_000,
)

it.instance(
  "a prompt to a paused session is held without a turn; unpause answers it and announces the release",
  () =>
    Effect.gen(function* () {
      const ctx = yield* setup()
      yield* ctx.llm.text("first answer")
      yield* ctx.prompt.prompt(text(ctx.chat.id, "first question"))
      const pause = yield* ctx.prompt.pause({ sessionID: ctx.chat.id, source: { kind: "tool", sessionID: "ses_other" } })
      expect(pause.pause.state).toBe("paused")
      expect(pause.pause.stoppedAt).toBeUndefined()

      const delivery = { delivery_id: "evt_held" }
      const held = yield* ctx.prompt.prompt({
        ...text(ctx.chat.id, "held words"),
        parts: [{ type: "text", text: "held words", metadata: { vibeterm: delivery } }],
      })
      expect(held.info.role).toBe("user")
      expect(yield* ctx.llm.calls).toBe(1)
      const refused = yield* ctx.prompt.sendNow(ctx.chat.id).pipe(Effect.flip)
      expect(refused.reason).toBe("paused")
      expect((yield* ctx.pauses.get(ctx.chat.id))?.held).toEqual([
        { messageID: held.info.id, at: held.info.time.created, delivery },
      ])

      const released: GlobalEvent[] = []
      const listener = (event: GlobalEvent) => {
        if (event.payload?.type === "session.pause.released") released.push(event)
      }
      GlobalBus.on("event", listener)
      yield* Effect.addFinalizer(() => Effect.sync(() => GlobalBus.off("event", listener)))
      yield* ctx.llm.text("answer to the held prompt")
      yield* ctx.prompt.unpause({ sessionID: ctx.chat.id })
      yield* ctx.llm.wait(2)
      yield* idle(ctx.chat.id)
      expect(JSON.stringify((yield* ctx.llm.inputs)[1])).toContain("held words")
      expect(released.map((event) => event.payload.properties.held[0].messageID)).toEqual([held.info.id])
    }),
  { git: true },
  60_000,
)

it.instance(
  "a new message that asks to unpause runs the deferred calls first, then itself",
  () =>
    Effect.gen(function* () {
      const ctx = yield* pausedWithThreeCalls()
      yield* ctx.llm.text("answer to the new message")
      yield* ctx.prompt.prompt(text(ctx.chat.id, "new words", { unpause: true }))
      expect(yield* ctx.llm.calls).toBe(2)
      expect(toolParts(yield* ctx.sessions.messages({ sessionID: ctx.chat.id })).map((part) => part.state.status)).toEqual([
        "completed",
        "completed",
        "completed",
      ])
      const body = JSON.stringify((yield* ctx.llm.inputs)[1])
      expect(body.indexOf("three-output")).toBeGreaterThan(-1)
      expect(body.indexOf("new words")).toBeGreaterThan(body.indexOf("three-output"))
      expect(yield* ctx.pauses.get(ctx.chat.id)).toBeUndefined()
    }),
  { git: true },
  60_000,
)

it.instance(
  "discard settles the deferred calls as not run and keeps the session paused",
  () =>
    Effect.gen(function* () {
      const ctx = yield* pausedWithThreeCalls()
      expect(yield* ctx.prompt.discard({ sessionID: ctx.chat.id })).toEqual({ sessionID: ctx.chat.id, discarded: 3 })
      const parts = toolParts(yield* ctx.sessions.messages({ sessionID: ctx.chat.id }))
      expect(parts.map((part) => part.state.status === "error" && part.state.error)).toEqual([
        "not run: discarded by /discard",
        "not run: discarded by /discard",
        "not run: discarded by /discard",
      ])
      expect((yield* ctx.pauses.get(ctx.chat.id))?.state).toBe("paused")
      expect(yield* ctx.llm.calls).toBe(1)

      yield* ctx.llm.text("understood")
      expect((yield* ctx.prompt.unpause({ sessionID: ctx.chat.id })).deferred).toBe(0)
      yield* ctx.llm.wait(2)
      yield* idle(ctx.chat.id)
      expect(JSON.stringify((yield* ctx.llm.inputs)[1])).toContain("not run: discarded by /discard")
    }),
  { git: true },
  60_000,
)

it.instance(
  "an abort keeps the deferred calls, and the pause, for unpause",
  () =>
    Effect.gen(function* () {
      const ctx = yield* pausedWithThreeCalls()
      yield* ctx.prompt.cancel(ctx.chat.id)
      expect(toolParts(yield* ctx.sessions.messages({ sessionID: ctx.chat.id })).every(SessionPause.isDeferred)).toBe(true)
      expect((yield* ctx.pauses.get(ctx.chat.id))?.state).toBe("paused")
    }),
  { git: true },
  60_000,
)

it.instance(
  "the pause and its deferred calls survive reloading the instance, and unpause still runs them",
  () =>
    Effect.gen(function* () {
      const ctx = yield* pausedWithThreeCalls()
      const store = yield* InstanceStore.Service
      yield* store.reload({ directory: ctx.directory })
      expect((yield* ctx.pauses.get(ctx.chat.id))?.state).toBe("paused")
      expect([...(yield* ctx.pauses.list()).keys()]).toEqual([ctx.chat.id])
      expect(toolParts(yield* ctx.sessions.messages({ sessionID: ctx.chat.id })).every(SessionPause.isDeferred)).toBe(true)

      yield* ctx.llm.text("ran after the reload")
      expect((yield* ctx.prompt.unpause({ sessionID: ctx.chat.id })).deferred).toBe(3)
      yield* ctx.llm.wait(2)
      yield* idle(ctx.chat.id)
      expect(toolParts(yield* ctx.sessions.messages({ sessionID: ctx.chat.id })).map((part) => part.state.status)).toEqual([
        "completed",
        "completed",
        "completed",
      ])
    }),
  { git: true },
  60_000,
)

it.instance("a pause covers the session's subagent sessions until the same unpause", () =>
  Effect.gen(function* () {
    const ctx = yield* setup()
    const child = yield* ctx.sessions.create({ parentID: ctx.chat.id, title: "Child" })
    yield* ctx.prompt.pause({ sessionID: ctx.chat.id, source: { kind: "api", client: "portal" }, reason: "restart" })
    const inherited = yield* ctx.pauses.get(child.id)
    expect(inherited?.root).toBe(ctx.chat.id)
    expect(inherited?.reason).toBe("restart")
    expect(inherited?.source).toEqual({ kind: "api", client: "portal" })
    expect([...(yield* ctx.pauses.list()).keys()].sort()).toEqual([ctx.chat.id, child.id].sort())
    yield* ctx.prompt.unpause({ sessionID: ctx.chat.id })
    expect(yield* ctx.pauses.get(child.id)).toBeUndefined()
  }),
)

it.instance(
  "a subagent paused through its parent waits at its step boundary, and the parent's unpause finishes both",
  () =>
    Effect.gen(function* () {
      const ctx = yield* setup()
      const marker = path.join(ctx.directory, "release")
      yield* ctx.llm.tool("task", { description: "child work", prompt: "do child work", subagent_type: "general" })
      yield* ctx.llm.tool("bash", {
        command: `while [ ! -f '${marker}' ]; do sleep 0.01; done; echo child-tool-done`,
        description: "wait",
      })
      const turn = yield* ctx.prompt.prompt(text(ctx.chat.id, "delegate")).pipe(Effect.forkChild)
      const child = yield* pollWithTimeout(
        ctx.sessions.children(ctx.chat.id).pipe(Effect.map((children) => children[0])),
        "the subagent session never appeared",
        "10 seconds",
      )
      yield* ctx.llm.wait(2)
      yield* ctx.prompt.pause({ sessionID: ctx.chat.id, source: { kind: "tui" } })
      expect((yield* ctx.pauses.get(child.id))?.root).toBe(ctx.chat.id)
      yield* (yield* FSUtil.Service).writeWithDirs(marker, "")
      yield* pollWithTimeout(
        ctx.pauses.get(child.id).pipe(Effect.map((pause) => (pause?.stoppedAt ? true : undefined))),
        "the subagent never stopped at its step boundary",
        "10 seconds",
      )
      expect(yield* ctx.llm.calls).toBe(2)

      yield* ctx.llm.text("child done")
      yield* ctx.llm.text("parent done")
      yield* ctx.prompt.unpause({ sessionID: ctx.chat.id })
      yield* Fiber.join(turn)
      yield* idle(ctx.chat.id)
      expect(yield* ctx.llm.calls).toBe(4)
      expect(yield* ctx.pauses.get(child.id)).toBeUndefined()
      const task = toolParts(yield* ctx.sessions.messages({ sessionID: ctx.chat.id }))[0]
      expect(task.state.status === "completed" && task.state.output).toContain("child done")
    }),
  { git: true },
  60_000,
)
