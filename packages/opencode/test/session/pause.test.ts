import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { eq, sql } from "drizzle-orm"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { EventV2Bridge } from "@/event-v2-bridge"
import { expect } from "bun:test"
import { Context, Deferred, Effect, Exit, Fiber, Layer } from "effect"
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
import { Snapshot } from "@/snapshot"
import { LiveEvents } from "../../src/session/live-events"
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
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { httpError, raw, reply, TestLLMServer, type Item } from "../lib/llm-server"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceStore } from "@/project/instance-store"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { AutoSwitch } from "@/session/auto-switch"
import { MeridianRouting } from "@/provider/meridian-routing"

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

/*
 * A loop that stopped at its step boundary still finishes its step before its run ends: it waits for the step's
 * snapshots, which took 13s on m4max on 2026-11-16. `hold` keeps that settle open for a paused session that has
 * stopped, so a test can unpause it inside that window.
 */
const settleHold: {
  current?: { readonly reached: Deferred.Deferred<void>; readonly release: Deferred.Deferred<void> }
} = {}
const realProcessor = SessionProcessor.node.implementation as Layer.Layer<SessionProcessor.Service>
const heldSettle = LayerNode.make({
  service: SessionProcessor.Service,
  layer: Layer.effect(
    SessionProcessor.Service,
    Effect.gen(function* () {
      const real = yield* SessionProcessor.Service
      const pauses = yield* SessionPause.Service
      return SessionProcessor.Service.of({
        ...real,
        settle: (sessionID) =>
          Effect.gen(function* () {
            const hold = settleHold.current
            if (hold && (yield* pauses.get(sessionID))?.stoppedAt !== undefined) {
              settleHold.current = undefined
              yield* Deferred.succeed(hold.reached, undefined)
              yield* Deferred.await(hold.release)
            }
            return yield* real.settle(sessionID)
          }),
      })
    }),
  ).pipe(Layer.provide(realProcessor)),
  deps: [
    Session.node,
    Config.node,
    Snapshot.node,
    AgentSvc.node,
    LLM.node,
    Permission.node,
    Plugin.node,
    SessionSummary.node,
    SessionStatus.node,
    Image.node,
    EventV2Bridge.node,
    Database.node,
    LiveEvents.node,
    SessionPause.node,
  ],
})

/*
 * A chat.message hook that throws while the unpause notice is created: on desktop on 2026-11-17 a Vibeterm plugin's
 * hook failed there with "database is locked" after the pause record was already cleared.
 */
const failingNotice: { action?: SessionPause.Action } = {}
const realPlugin = Plugin.node.implementation as Layer.Layer<Plugin.Service>
const flakyPlugin = LayerNode.make({
  service: Plugin.Service,
  layer: Layer.effect(
    Plugin.Service,
    Effect.gen(function* () {
      const real = yield* Plugin.Service
      return Plugin.Service.of({
        ...real,
        trigger: (name, input, output) => {
          const parts = (output as { parts?: readonly { metadata?: { pause?: { action?: string } } }[] }).parts ?? []
          const action = failingNotice.action
          if (name === "chat.message" && action && parts.some((part) => part.metadata?.pause?.action === action)) {
            failingNotice.action = undefined
            return Effect.die(new Error("SQLiteError: database is locked"))
          }
          return real.trigger(name, input, output)
        },
      })
    }),
  ).pipe(Layer.provide(realPlugin)),
  deps: [EventV2Bridge.node, Config.node, RuntimeFlags.node, Session.node, LiveEvents.node, SessionStatus.node],
})

const BeforeTouch = Context.Reference("test/BeforeTouch", {
  defaultValue: () => Effect.void,
})
const heldTouch = LayerNode.make({
  service: Session.Service,
  layer: Layer.effect(
    Session.Service,
    Effect.gen(function* () {
      const real = yield* Session.Service
      return Session.Service.of({
        ...real,
        touch: (sessionID) =>
          Effect.gen(function* () {
            const beforeTouch = yield* BeforeTouch
            yield* beforeTouch
            yield* real.touch(sessionID)
          }),
      })
    }),
  ).pipe(Layer.provide(Session.node.implementation as Layer.Layer<Session.Service>)),
  deps: [BackgroundJob.node, RuntimeFlags.node, Database.node, EventV2Bridge.node, LiveEvents.node],
})

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
    [SessionProcessor.node, heldSettle],
    [Plugin.node, flakyPlugin],
    [Session.node, heldTouch],
  ]),
)

const ref = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") }
const other = { ...ref, modelID: ModelV2.ID.make("other-model") }
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
            "other-model": {
              id: "other-model",
              name: "Other Model",
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

it.instance("a trusted refusal switches once and only a new submission after idle can return to Claude", () =>
  Effect.gen(function* () {
    const llm = yield* TestLLMServer
    const source = { agent: "build", providerID: "anthropic", modelID: "claude-opus-5-5", variant: "high" }
    const target = { agent: "build", providerID: "openai", modelID: "gpt-6.2-sol", variant: "xhigh" }
    const wire: string[] = []
    let claudeRecovered = false
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          async fetch(request) {
            const url = new URL(request.url)
            if (url.pathname === "/profiles/route-availability") {
              const queried = url.searchParams.get("provider") === "claude" ? source : target
              wire.push(queried === source ? "preflight-claude" : "preflight-chatgpt")
              return Response.json({
                version: 1,
                provider: queried === source ? "claude" : "chatgpt",
                model: queried.modelID,
                variant: queried.variant,
                available: queried === target || claudeRecovered,
                observed_at: Date.now(),
                routable_allotment: 1,
              })
            }
            if (url.pathname === "/v1/messages") {
              wire.push("claude")
              if (claudeRecovered) {
                const encode = (event: { type: string }) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
                const events = [
                  { type: "message_start", message: { id: "msg_source", type: "message", role: "assistant",
                    model: source.modelID, content: [], usage: { input_tokens: 10, output_tokens: 0 }, stop_reason: null } },
                  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
                  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "preferred recovered" } },
                  { type: "content_block_stop", index: 0 },
                  { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } },
                  { type: "message_stop" },
                ]
                return new Response(events.map(encode).join(""), { headers: { "content-type": "text/event-stream" } })
              }
              return Response.json(
                {
                  type: "error",
                  error: {
                    type: "rate_limit_error",
                    code: "no_routable_account",
                    message: "No routable Claude account: pilot fixture",
                    request_id: request.headers.get("x-request-id"),
                    route_refusal: {
                      version: 1,
                      phase: "before_inference",
                      sent: false,
                      provider: "claude",
                      model: source.modelID,
                      reason: "quota_exhausted",
                    },
                  },
                },
                { status: 429 },
              )
            }
            if (url.pathname === "/v1/responses") {
              wire.push("chatgpt")
              return fetch(new Request(new URL(url.pathname, llm.url), request))
            }
            return new Response(null, { status: 404 })
          },
        }),
      ),
      (server) => Effect.promise(() => server.stop(true)),
    )
    const options = { apiKey: "fixture-key", baseURL: new URL("/v1", server.url).href }
    const model = { reasoning: true, tool_call: true, limit: { context: 256_000, output: 10_000 } }
    const ctx = yield* setup({
      enabled_providers: [source.providerID, target.providerID],
      provider: {
        [source.providerID]: {
          npm: "@ai-sdk/anthropic",
          options,
          models: { [source.modelID]: { ...model, name: source.modelID, variants: { high: { effort: "high" } } } },
        },
        [target.providerID]: {
          npm: "@ai-sdk/openai",
          options,
          models: {
            [target.modelID]: { ...model, name: target.modelID, variants: { xhigh: { reasoningEffort: "xhigh" } } },
          },
        },
      },
    })
    yield* llm.text("served by the alternate")
    const prompt = text(ctx.chat.id, "exact pilot user input", {
      model: {
        providerID: ProviderV2.ID.make(source.providerID),
        modelID: ModelV2.ID.make(source.modelID),
      },
      variant: source.variant,
    })
    const providers = yield* ProviderSvc.Service
    const owner = <A, E, R>(work: Effect.Effect<A, E, R>) => work.pipe(
      Effect.provideService(AutoSwitch.Owner, () => ctx.chat.id),
      Effect.provideService(AutoSwitch.Providers, providers),
      Effect.provideService(AutoSwitch.Policy, () => ({ enabled: true, reason: "default-on", alternates: [target], policyRevision: "test-1" })),
      Effect.provideService(MeridianRouting.Trust, {
        claudeInferenceURL: new URL("/v1/messages", server.url).href,
        chatgptAvailabilityURL: new URL("/profiles/route-availability", server.url).href,
      }),
    )
    const result = yield* owner(ctx.prompt.prompt(prompt))
    expect(wire).toEqual(["claude", "preflight-chatgpt", "chatgpt"])
    expect(result.info).toMatchObject({
      role: "assistant",
      parentID: prompt.messageID,
      agent: target.agent,
      providerID: target.providerID,
      modelID: target.modelID,
      variant: target.variant,
    })
    const messages = yield* ctx.sessions.messages({ sessionID: ctx.chat.id })
    expect(messages.filter((entry) => entry.info.role === "user").map((entry) => entry.info.id)).toEqual([
      prompt.messageID,
    ])
    const current = yield* ctx.sessions.get(ctx.chat.id)
    expect(AutoSwitch.preferred(current)).toEqual(source)
    expect(AutoSwitch.stored(current).episode).toMatchObject({ step: 1, turnID: prompt.messageID, state: "active" })
    claudeRecovered = true
    const returning = yield* owner(AutoSwitch.read(ctx.sessions, ctx.chat.id))
    expect(returning).toMatchObject({ effective: target, next: source, returnState: "returning" })
    yield* pollWithTimeout(Effect.sync(() => Date.now() > result.info.time.created || undefined), "new admission timestamp")
    const next = text(ctx.chat.id, "new prompt after idle", { model: prompt.model, variant: source.variant })
    const returned = yield* owner(ctx.prompt.prompt(next))
    expect(returned.info).toMatchObject({ parentID: next.messageID, agent: source.agent, providerID: source.providerID, modelID: source.modelID })
    expect(wire).toEqual(["claude", "preflight-chatgpt", "chatgpt", "preflight-claude", "preflight-claude", "claude"])
  }),
)

it.instance("an owner preference revision cannot be rolled back by a stale metadata write or copied into a fork", () =>
  Effect.gen(function* () {
    const ctx = yield* setup()
    const revision = { sessionId: ctx.chat.id, revision: 1, preference: "off" }
    expect(
      yield* ctx.sessions.updateAutoSwitch({
        sessionID: ctx.chat.id,
        revision: 0,
        preference: "off",
        episode: undefined,
        current: () => Effect.succeed(true),
      }),
    ).toBe(true)
    yield* ctx.sessions.setMetadata({ sessionID: ctx.chat.id, metadata: { unrelated: "preserved" } })
    expect((yield* ctx.sessions.get(ctx.chat.id)).metadata).toMatchObject({
      unrelated: "preserved",
      vibeterm: { autoSwitch: revision },
    })
    const fork = yield* ctx.sessions.fork({ sessionID: ctx.chat.id })
    expect(fork.metadata?.vibeterm?.autoSwitch).toBeUndefined()
  }),
)

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
  "an unpause whose notice cannot be written still resumes the turn and runs its deferred calls",
  () =>
    Effect.gen(function* () {
      const ctx = yield* pausedWithThreeCalls()
      yield* ctx.llm.text("all three ran")
      failingNotice.action = "unpause"
      const result = yield* ctx.prompt
        .unpause({ sessionID: ctx.chat.id, source: { kind: "tui" } })
        .pipe(Effect.ensuring(Effect.sync(() => (failingNotice.action = undefined))))
      expect(result).toEqual({ sessionID: ctx.chat.id, changed: true, deferred: 3 })
      yield* ctx.llm.wait(2)
      yield* idle(ctx.chat.id)
      expect(yield* ctx.pauses.get(ctx.chat.id)).toBeUndefined()
      const ran = toolParts(yield* ctx.sessions.messages({ sessionID: ctx.chat.id }))
      expect(ran.map((part) => part.state.status)).toEqual(["completed", "completed", "completed"])
    }),
  { git: true },
  60_000,
)

it.instance(
  "unpause discards a switched assistant's deferred batch without starting its tools",
  () =>
    Effect.gen(function* () {
      const ctx = yield* pausedWithThreeCalls()
      const fs = yield* FSUtil.Service
      const started = path.join(ctx.directory, "deferred-tool-started.txt")
      const parts = toolParts(yield* ctx.sessions.messages({ sessionID: ctx.chat.id }))
      const first = parts[0]
      if (first?.state.status !== "pending") throw new Error("expected a paused tool call")
      const deferred = SessionPause.deferredOf(first.state.metadata ?? {})
      if (!deferred) throw new Error("missing pause deferral")
      yield* ctx.sessions.updatePart({
        ...first,
        state: {
          ...first.state,
          input: { command: `printf started > ${JSON.stringify(started)}`, description: "fixture side effect" },
          metadata: {
            ...first.state.metadata,
            deferred: SessionPause.deferredResult(deferred.at, true).metadata.deferred,
          },
        },
      })
      yield* ctx.llm.text("unexpected replay follow-up")

      yield* ctx.prompt.unpause({ sessionID: ctx.chat.id })

      const settled = yield* pollWithTimeout(
        ctx.sessions.messages({ sessionID: ctx.chat.id }).pipe(
          Effect.map((messages) => {
            const tools = toolParts(messages)
            return tools.every((part) => part.state.status === "completed" || part.state.status === "error")
              ? tools
              : undefined
          }),
        ),
        "the deferred batch did not settle",
        "10 seconds",
      )
      yield* idle(ctx.chat.id)
      expect(settled.map((part) => part.state.status === "error" && part.state.metadata?.discardReason)).toEqual(
        Array(3).fill("unsafe-deferred-route"),
      )
      expect(yield* fs.existsSafe(started)).toBe(false)
      expect(yield* ctx.llm.calls).toBe(1)
    }),
  { git: true },
  60_000,
)

it.instance(
  "a pause whose notice cannot be written is still reported as taken",
  () =>
    Effect.gen(function* () {
      const ctx = yield* setup()
      failingNotice.action = "pause"
      const result = yield* ctx.prompt
        .pause({ sessionID: ctx.chat.id, source: { kind: "tui" } })
        .pipe(Effect.ensuring(Effect.sync(() => (failingNotice.action = undefined))))
      expect(result.changed).toBe(true)
      expect(yield* ctx.pauses.get(ctx.chat.id)).toBeDefined()
    }),
  { git: true },
  60_000,
)

it.instance(
  "an unpause that lands while the stopped loop is still finishing its step resumes the turn",
  () =>
    Effect.gen(function* () {
      const ctx = yield* setup()
      const gate = yield* Deferred.make<void>()
      yield* ctx.llm.push(
        reply()
          .wait(Effect.runPromise(Deferred.await(gate)))
          .text("one tool")
          .tool("bash", { command: "printf '%s-%s' resumed call", description: "one" }),
      )
      const hold = { reached: yield* Deferred.make<void>(), release: yield* Deferred.make<void>() }
      settleHold.current = hold
      yield* Effect.gen(function* () {
        const turn = yield* ctx.prompt.prompt(text(ctx.chat.id, "do the work")).pipe(Effect.forkChild)
        yield* ctx.llm.wait(1)
        yield* ctx.prompt.pause({ sessionID: ctx.chat.id, source: { kind: "tui" } })
        yield* Deferred.succeed(gate, undefined)
        yield* Deferred.await(hold.reached).pipe(Effect.timeout("20 seconds"))
        expect((yield* ctx.pauses.get(ctx.chat.id))?.stoppedAt).toBeNumber()

        yield* ctx.llm.text("carried on")
        const result = yield* ctx.prompt.unpause({ sessionID: ctx.chat.id, source: { kind: "tui" } })
        expect(result).toEqual({ sessionID: ctx.chat.id, changed: true, deferred: 1 })
        yield* Deferred.succeed(hold.release, undefined)
        yield* Fiber.join(turn)
        yield* pollWithTimeout(
          ctx.llm.calls.pipe(Effect.map((calls) => (calls >= 2 ? true : undefined))),
          "the unpaused turn never called the model again",
          "10 seconds",
        )
        yield* idle(ctx.chat.id)
        expect(yield* ctx.pauses.get(ctx.chat.id)).toBeUndefined()
        const ran = toolParts(yield* ctx.sessions.messages({ sessionID: ctx.chat.id }))
        expect(ran.map((part) => part.state.status)).toEqual(["completed"])
      }).pipe(
        Effect.ensuring(
          Effect.suspend(() => {
            settleHold.current = undefined
            return Deferred.succeed(hold.release, undefined)
          }),
        ),
      )
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
      const pause = yield* ctx.prompt.pause({
        sessionID: ctx.chat.id,
        source: { kind: "tool", sessionID: "ses_other" },
      })
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
  "unpause with a composer selection updates the held prompt, not the completed turn or ignored notices",
  () =>
    Effect.gen(function* () {
      const ctx = yield* setup()
      const sessionID = ctx.chat.id
      yield* ctx.llm.text("finished")
      const previous = text(sessionID, "previous question", { variant: "high" })
      yield* ctx.prompt.prompt(previous)
      yield* ctx.prompt.pause({ sessionID })
      const held = text(sessionID, "held question", { variant: "high" })
      yield* ctx.prompt.prompt(held)
      const notice = yield* ctx.prompt.prompt({
        ...text(sessionID, "ignored"),
        noReply: true,
        parts: [{ type: "text", text: "ignored", ignored: true }],
      })
      yield* ctx.llm.text("resumed")

      const model = other
      const input = { sessionID, selection: { agent: "plan", model } }
      yield* ctx.prompt.unpause(input)
      yield* ctx.llm.wait(2)
      yield* idle(sessionID)

      const messages = yield* ctx.sessions.messages({ sessionID })
      expect(messages.findLast((msg) => msg.info.role === "assistant")?.info).toMatchObject({
        parentID: held.messageID,
        agent: "plan",
        modelID: model.modelID,
      })
      const users = messages.flatMap((msg) => (msg.info.role === "user" ? [msg.info] : []))
      expect(users.find((msg) => msg.id === held.messageID)?.model).toEqual(model)
      expect(users.find((msg) => msg.id === previous.messageID)?.model.variant).toBe("high")
      expect(users.find((msg) => msg.id === notice.info.id)?.model).toEqual(ref)
      expect(
        messages
          .filter((msg) => msg.info.role === "user" && msg.parts.some((part) => part.type === "text" && !part.ignored))
          .map((msg) => msg.info.id),
      ).toEqual([previous.messageID, held.messageID])
      expect((yield* ctx.sessions.get(sessionID)).model).toEqual({
        providerID: model.providerID,
        id: model.modelID,
        variant: "default",
      })
    }),
  { git: true },
)

it.instance(
  "unpause during a pending step applies its selection to the continuation, not the later turn-end prompt",
  () =>
    Effect.gen(function* () {
      const ctx = yield* setup({ queued_prompts: "turn_end" })
      const sessionID = ctx.chat.id
      const gate = yield* Deferred.make<void>()
      yield* ctx.llm.push(
        reply()
          .wait(Effect.runPromise(Deferred.await(gate)))
          .tool("bash", {
            command: "printf resume-tool-output",
            description: "resume tool",
          }),
      )
      const active = text(sessionID, "active question")
      const turn = yield* ctx.prompt.prompt(active).pipe(Effect.forkChild)
      yield* ctx.llm.wait(1)
      expect((yield* ctx.prompt.pause({ sessionID })).pause.state).toBe("pending")
      const queued = text(sessionID, "later question")
      yield* ctx.prompt.prompt(queued)
      yield* ctx.llm.text("continued")
      yield* ctx.llm.text("answered the later prompt")

      const model = { ...other, variant: "high" }
      const input = { sessionID, selection: { agent: "plan", model } }
      yield* ctx.prompt.unpause(input)
      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.join(turn)
      yield* ctx.llm.wait(3)
      yield* idle(sessionID)

      const history = yield* ctx.sessions.messages({ sessionID })
      expect(
        history.flatMap(({ info }) =>
          info.role === "assistant" ? [[info.parentID, info.agent, info.modelID, info.variant]] : [],
        ),
      ).toEqual([
        [active.messageID, "build", ref.modelID, undefined],
        [active.messageID, "plan", model.modelID, "high"],
        [queued.messageID, "build", ref.modelID, undefined],
      ])
      const requests = yield* ctx.llm.inputs
      expect(requests.map((request) => request.model)).toEqual([ref.modelID, model.modelID, ref.modelID])
      expect(JSON.stringify(requests[1].messages)).toContain("resume-tool-output")
      expect(JSON.stringify(requests[1].messages)).not.toContain("later question")
    }),
  { git: true },
)

it.instance(
  "unpause with a composer selection does not rewrite a pending step that finishes the turn",
  () =>
    Effect.gen(function* () {
      const ctx = yield* setup()
      const sessionID = ctx.chat.id
      const gate = yield* Deferred.make<void>()
      yield* ctx.llm.push(
        reply()
          .wait(Effect.runPromise(Deferred.await(gate)))
          .text("finished")
          .stop(),
      )
      const user = text(sessionID, "finish in one step", { variant: "low" })
      const turn = yield* ctx.prompt.prompt(user).pipe(Effect.forkChild)
      yield* ctx.llm.wait(1)
      expect((yield* ctx.prompt.pause({ sessionID })).pause.state).toBe("pending")

      yield* ctx.prompt.unpause({
        sessionID,
        selection: { agent: "plan", model: other },
      })
      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.join(turn)
      yield* idle(sessionID)

      const messages = yield* ctx.sessions.messages({ sessionID })
      expect(messages.find((msg) => msg.info.id === user.messageID)?.info).toMatchObject({
        agent: "build",
        model: { ...ref, variant: "low" },
      })
      expect(yield* ctx.llm.calls).toBe(1)
    }),
  { git: true },
)

it.instance(
  "unpause at async admission answers the held prompt even before its activity update",
  () =>
    Effect.gen(function* () {
      const ctx = yield* setup()
      yield* ctx.prompt.pause({ sessionID: ctx.chat.id })
      yield* ctx.llm.text("answer to the admitted prompt")
      const input = text(ctx.chat.id, "admitted while paused")
      const admission = yield* Deferred.make<void, SessionPrompt.AdmissionError>()
      const touching = yield* Deferred.make<void>()
      const resume = yield* Deferred.make<void>()
      const turn = yield* ctx.prompt
        .prompt(input, admission)
        .pipe(
          Effect.provideService(
            BeforeTouch,
            Deferred.succeed(touching, undefined).pipe(Effect.andThen(Deferred.await(resume))),
          ),
          Effect.forkChild,
        )
      yield* awaitWithTimeout(
        Effect.raceFirst(
          Deferred.await(touching),
          Fiber.join(turn).pipe(Effect.andThen(Effect.die(new Error("prompt ended before its activity update")))),
        ),
        "prompt did not reach its activity update",
        "15 seconds",
      )
      yield* awaitWithTimeout(Deferred.await(admission), "prompt did not acknowledge admission")

      yield* ctx.prompt.unpause({ sessionID: ctx.chat.id })
      yield* Deferred.succeed(resume, undefined)
      yield* Fiber.join(turn)
      yield* awaitWithTimeout(ctx.llm.wait(1), "unpause stranded the acknowledged prompt", "10 seconds")
      yield* idle(ctx.chat.id)
      expect(JSON.stringify((yield* ctx.llm.inputs)[0])).toContain("admitted while paused")
      expect(yield* ctx.llm.calls).toBe(1)
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
      expect(
        toolParts(yield* ctx.sessions.messages({ sessionID: ctx.chat.id })).map((part) => part.state.status),
      ).toEqual(["completed", "completed", "completed"])
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
      expect(toolParts(yield* ctx.sessions.messages({ sessionID: ctx.chat.id })).every(SessionPause.isDeferred)).toBe(
        true,
      )
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
      expect(toolParts(yield* ctx.sessions.messages({ sessionID: ctx.chat.id })).every(SessionPause.isDeferred)).toBe(
        true,
      )

      yield* ctx.llm.text("ran after the reload")
      expect((yield* ctx.prompt.unpause({ sessionID: ctx.chat.id })).deferred).toBe(3)
      yield* ctx.llm.wait(2)
      yield* idle(ctx.chat.id)
      expect(
        toolParts(yield* ctx.sessions.messages({ sessionID: ctx.chat.id })).map((part) => part.state.status),
      ).toEqual(["completed", "completed", "completed"])
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

/*
 * 2026-11-15, Portal live check: a cleared pause came back. Unpause deleted the `pause` key, and session sync, which
 * adds every metadata key the local row lacks, copied it back from desktop's copy still holding the old pending pause.
 * `json_insert` applies the same add-only-if-missing rule to the row.
 */
it.instance("a cleared pause stays cleared when a peer's stale copy is merged in", () =>
  Effect.gen(function* () {
    const ctx = yield* setup()
    const stale = (yield* ctx.prompt.pause({ sessionID: ctx.chat.id, source: { kind: "api", client: "portal" } })).pause
    yield* ctx.prompt.unpause({ sessionID: ctx.chat.id })
    const { db } = yield* Database.Service
    yield* db
      .update(SessionTable)
      .set({ metadata: sql`json_insert(${SessionTable.metadata}, '$.pause', json(${JSON.stringify(stale)}))` })
      .where(eq(SessionTable.id, ctx.chat.id))
      .run()
      .pipe(Effect.orDie)
    expect(yield* ctx.pauses.get(ctx.chat.id)).toBeUndefined()
    expect((yield* ctx.pauses.list()).has(ctx.chat.id)).toBe(false)
    expect((yield* ctx.prompt.sendNow(ctx.chat.id).pipe(Effect.flip)).reason).toBe("empty")
  }),
)

for (const action of ["unpause", "discard"] as const) {
  for (const replacement of [
    { name: "timestamp", at: 1 },
    { name: "source kind", source: { kind: "api" as const } },
    { name: "source session", source: { kind: "tui" as const, sessionID: "ses_other" } },
    { name: "source title", source: { kind: "tui" as const, sessionTitle: "Other" } },
    { name: "source machine", source: { kind: "tui" as const, machine: "other" } },
    { name: "source tool", source: { kind: "tui" as const, tool: "other" } },
    { name: "source client", source: { kind: "tui" as const, client: "other" } },
  ]) {
    it.instance(
      `${action} refuses a replacement pause with a changed ${replacement.name} without changing deferred calls`,
      () =>
        Effect.gen(function* () {
          const ctx = yield* pausedWithThreeCalls()
          const observed = yield* ctx.pauses.get(ctx.chat.id)
          if (!observed) throw new Error("expected the fixture to be paused")
          const input = {
            sessionID: ctx.chat.id,
            expectedPauseAt: observed.at,
            expectedPauseSource: observed.source,
          }
          const request =
            action === "unpause"
              ? ctx.prompt.unpause(input).pipe(Effect.asVoid)
              : ctx.prompt.discard(input).pipe(Effect.asVoid)
          const next = {
            ...observed,
            at: observed.at + (replacement.at ?? 0),
            source: replacement.source ?? observed.source,
          }
          yield* ctx.pauses.write(ctx.chat.id, next)
          const before = yield* ctx.sessions.messages({ sessionID: ctx.chat.id })

          const result = yield* request.pipe(Effect.exit)

          expect(Exit.isFailure(result)).toBe(true)
          expect(
            Exit.isFailure(result) &&
              result.cause.reasons.some(
                (reason) => reason._tag === "Fail" && reason.error instanceof SessionPause.ChangedError,
              ),
          ).toBe(true)
          expect(yield* ctx.pauses.get(ctx.chat.id)).toEqual(next)
          expect(yield* ctx.sessions.messages({ sessionID: ctx.chat.id })).toEqual(before)
          expect(yield* ctx.llm.calls).toBe(1)
        }),
      { git: true },
      60_000,
    )
  }

  for (const expectation of ["timestamp", "source", "both"] as const) {
    it.instance(
      `${action} accepts matching ${expectation} identity with reordered source keys`,
      () =>
        Effect.gen(function* () {
          const ctx = yield* pausedWithThreeCalls()
          const observed = yield* ctx.pauses.get(ctx.chat.id)
          if (!observed) throw new Error("expected the fixture to be paused")
          const source = {
            kind: "tool" as const,
            client: "vibeterm",
            machine: "test",
            tool: "move",
            sessionID: "ses_owner",
            sessionTitle: "Owner",
          }
          yield* ctx.pauses.write(ctx.chat.id, { ...observed, source })
          yield* ctx.llm.text("continued")
          const input = {
            sessionID: ctx.chat.id,
            ...(expectation !== "source" && { expectedPauseAt: observed.at }),
            ...(expectation !== "timestamp" && {
              expectedPauseSource: {
                sessionTitle: "Owner",
                sessionID: "ses_owner",
                tool: "move",
                machine: "test",
                client: "vibeterm",
                kind: "tool" as const,
              },
            }),
          }

          const result = yield* ctx.prompt[action](input)

          if (action === "discard") {
            expect(result).toEqual({ sessionID: ctx.chat.id, discarded: 3 })
            expect((yield* ctx.pauses.get(ctx.chat.id))?.source).toEqual(source)
            expect(
              toolParts(yield* ctx.sessions.messages({ sessionID: ctx.chat.id })).map((part) => part.state.status),
            ).toEqual(["error", "error", "error"])
            expect(yield* ctx.llm.calls).toBe(1)
            return
          }
          expect(result).toEqual({ sessionID: ctx.chat.id, changed: true, deferred: 3 })
          yield* ctx.llm.wait(2)
          yield* idle(ctx.chat.id)
          expect(yield* ctx.pauses.get(ctx.chat.id)).toBeUndefined()
          expect(
            toolParts(yield* ctx.sessions.messages({ sessionID: ctx.chat.id })).map((part) => part.state.status),
          ).toEqual(["completed", "completed", "completed"])
        }),
      { git: true },
      60_000,
    )
  }
}

const refusalMessage = "No routable Claude account: 3 accounts spent (incident inc_1763330000000_7)"
const refusalBody = {
  type: "error",
  error: {
    type: "rate_limit_error",
    code: "no_routable_account",
    message: refusalMessage,
    reset_at: null,
    incident_id: "inc_1763330000000_7",
    request_id: "req_park",
    profiles: [{ id: "work", reason: "spent", resets_at: null }],
  },
}
const streamChunk = (delta: Record<string, unknown>) => ({
  id: "chatcmpl-test",
  object: "chat.completion.chunk",
  choices: [{ delta }],
})

// The model requests of the turn itself, without the title request.
const stepInputs = (inputs: Record<string, unknown>[]) =>
  inputs.filter((input) => !JSON.stringify(input).includes("Generate a title for this conversation"))

const assistants = (messages: SessionV1.WithParts[]) => messages.filter((msg) => msg.info.role === "assistant")

it.instance(
  "unpause with a composer selection retries a refused prompt on the chosen route without a new user message",
  () =>
    Effect.gen(function* () {
      const ctx = yield* setup({ queued_prompts: "turn_end" })
      const sessionID = ctx.chat.id
      const refused = text(sessionID, "wait for an account", { variant: "high" })
      yield* ctx.llm.push(httpError(429, refusalBody))
      yield* ctx.prompt.prompt(refused)
      expect((yield* ctx.pauses.get(sessionID))?.error?.model).toEqual(ref)
      yield* ctx.llm.text("answered on the chosen route")

      const model = other
      yield* ctx.prompt.unpause({ sessionID, selection: { agent: "plan", model } })
      yield* ctx.llm.wait(2)
      yield* idle(sessionID)

      expect(stepInputs(yield* ctx.llm.inputs).map((input) => input.model)).toEqual([ref.modelID, model.modelID])
      const messages = yield* ctx.sessions.messages({ sessionID })
      expect(assistants(messages).map((msg) => msg.info)).toMatchObject([
        { parentID: refused.messageID, agent: "plan", modelID: model.modelID },
      ])
      expect(messages.find((msg) => msg.info.id === refused.messageID)?.info).toMatchObject({ agent: "plan", model })
    }),
  { git: true },
)

/*
 * Runs a turn whose first model request Meridian refuses with `first`, and checks the session parked: one request,
 * no retry, the refused step and its partial output gone, the session paused with the refusal. Unpause must then
 * send the same request again and finish the turn.
 */
const parkAndUnpause = Effect.fn("test.parkAndUnpause")(function* (first: Item) {
  const ctx = yield* setup()
  yield* ctx.llm.push(first)
  yield* ctx.prompt.prompt(text(ctx.chat.id, "do the work"))
  expect(stepInputs(yield* ctx.llm.inputs)).toHaveLength(1)

  const pause = yield* ctx.pauses.get(ctx.chat.id)
  expect(pause?.state).toBe("paused")
  expect(pause?.stoppedAt).toBeNumber()
  expect(pause?.reason).toBe(refusalMessage)
  expect(pause?.source).toEqual({ kind: "api", client: "no_routable_account" })
  expect(pause?.error?.code).toBe("no_routable_account")
  expect(pause?.error?.incident_id).toBe("inc_1763330000000_7")
  const status = yield* (yield* SessionStatus.Service).get(ctx.chat.id)
  expect(status.type).toBe("idle")
  expect(status.paused?.reason).toBe(refusalMessage)
  const parked = yield* ctx.sessions.messages({ sessionID: ctx.chat.id })
  expect(assistants(parked)).toEqual([])
  expect(JSON.stringify(parked)).not.toContain("half an answer")

  // A loop finds the pause and calls nothing.
  yield* ctx.prompt.loop({ sessionID: ctx.chat.id })
  expect(stepInputs(yield* ctx.llm.inputs)).toHaveLength(1)

  yield* ctx.llm.text("answered after unpause")
  const calls = yield* ctx.llm.calls
  const result = yield* ctx.prompt.unpause({ sessionID: ctx.chat.id, source: { kind: "tui" } })
  expect(result).toEqual({ sessionID: ctx.chat.id, changed: true, deferred: 0 })
  yield* ctx.llm.wait(calls + 1)
  yield* idle(ctx.chat.id)
  expect(yield* ctx.pauses.get(ctx.chat.id)).toBeUndefined()

  const inputs = stepInputs(yield* ctx.llm.inputs)
  expect(inputs).toHaveLength(2)
  expect(inputs[1].messages).toEqual(inputs[0].messages)

  const messages = yield* ctx.sessions.messages({ sessionID: ctx.chat.id })
  const answers = assistants(messages)
  expect(answers).toHaveLength(1)
  expect(answers[0].info.role === "assistant" && answers[0].info.error).toBeUndefined()
  expect(answers[0].parts.flatMap((part) => (part.type === "text" ? [part.text] : []))).toEqual([
    "answered after unpause",
  ])
  const notices = messages.flatMap((msg) => msg.parts.filter((part) => part.type === "text" && part.ignored))
  expect(notices.map((part) => part.type === "text" && part.metadata?.pause?.action)).toEqual(["pause", "unpause"])
  expect(notices[0]?.type === "text" && notices[0].text).toContain(`reason: ${refusalMessage}`)
})

it.instance(
  "a no-routable-account refusal before the stream parks the step without retrying; unpause sends the same request",
  () => parkAndUnpause(httpError(429, refusalBody)),
  { git: true },
  60_000,
)

it.instance(
  "a no-routable-account refusal inside the stream drops the partial output and parks; unpause sends the same request",
  () =>
    parkAndUnpause(
      raw({
        // As @ai-sdk/anthropic passes it on: only the type and the message survive.
        head: [
          streamChunk({ role: "assistant" }),
          streamChunk({ content: "half an answer" }),
          { error: { type: "rate_limit_error", message: refusalMessage } },
        ],
      }),
    ),
  { git: true },
  60_000,
)

const answerTexts = (messages: SessionV1.WithParts[]) =>
  assistants(messages).flatMap((msg) => msg.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])))

/*
 * ses_e13fbe595ffeLpn236oxJ7OIZe, 2026-11-19 07:06Z: a step on a route no account could serve was in flight when
 * the user sent a prompt naming another route; the refusal parked the session and that prompt waited for a person.
 */
it.instance(
  "a refused step whose session has a newer prompt naming another model answers that prompt instead of parking",
  () =>
    Effect.gen(function* () {
      const ctx = yield* setup()
      const gate = yield* Deferred.make<void>()
      yield* ctx.llm.push(
        raw({
          head: [streamChunk({ role: "assistant" })],
          wait: Effect.runPromise(Deferred.await(gate)),
          tail: [{ error: { type: "rate_limit_error", message: refusalMessage } }],
        }),
      )
      yield* ctx.llm.text("answered on the other model")
      const turn = yield* ctx.prompt.prompt(text(ctx.chat.id, "do the work")).pipe(Effect.forkChild)
      yield* ctx.llm.wait(1)
      const next = yield* ctx.prompt.prompt(text(ctx.chat.id, "continue", { model: other })).pipe(Effect.forkChild)
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const messages = yield* ctx.sessions.messages({ sessionID: ctx.chat.id })
          return messages.some((msg) => msg.parts.some((part) => part.type === "text" && part.text === "continue"))
            ? true
            : undefined
        }),
        "the second prompt was never stored",
        "10 seconds",
      )
      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.join(turn)
      yield* Fiber.join(next)
      yield* idle(ctx.chat.id)

      expect(yield* ctx.pauses.get(ctx.chat.id)).toBeUndefined()
      const inputs = stepInputs(yield* ctx.llm.inputs)
      expect(inputs.map((input) => input.model)).toEqual(["test-model", "other-model"])
      const messages = yield* ctx.sessions.messages({ sessionID: ctx.chat.id })
      expect(answerTexts(messages)).toEqual(["answered on the other model"])
      const answer = assistants(messages)[0]?.info
      expect(answer?.role === "assistant" ? String(answer.modelID) : undefined).toBe("other-model")
    }),
  { git: true },
  60_000,
)

it.instance(
  "a refusal arriving after manual unpause does not park a pending turn on the old route",
  () =>
    Effect.gen(function* () {
      const ctx = yield* setup({ queued_prompts: "turn_end" })
      const sessionID = ctx.chat.id
      const gate = yield* Deferred.make<void>()
      yield* ctx.llm.push(
        raw({
          head: [streamChunk({ role: "assistant" })],
          wait: Effect.runPromise(Deferred.await(gate)),
          tail: [{ error: { type: "rate_limit_error", message: refusalMessage } }],
        }),
      )
      yield* ctx.llm.text("answered after switching routes")
      const input = text(sessionID, "keep my original prompt")
      const turn = yield* ctx.prompt.prompt(input).pipe(Effect.forkChild)
      yield* ctx.llm.wait(1)
      expect((yield* ctx.prompt.pause({ sessionID })).pause.state).toBe("pending")

      yield* ctx.prompt.unpause({ sessionID, selection: { agent: "plan", model: other } })
      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.join(turn)
      yield* idle(sessionID)

      expect(yield* ctx.pauses.get(sessionID)).toBeUndefined()
      expect(stepInputs(yield* ctx.llm.inputs).map((request) => request.model)).toEqual([ref.modelID, other.modelID])
      const messages = yield* ctx.sessions.messages({ sessionID })
      expect(assistants(messages).map((msg) => msg.info)).toMatchObject([
        { parentID: input.messageID, agent: "plan", modelID: other.modelID },
      ])
    }),
  { git: true },
)

it.instance(
  "a refusal park holds a prompt on the refused model, and a prompt naming another model lifts it and runs",
  () =>
    Effect.gen(function* () {
      const ctx = yield* setup()
      yield* ctx.llm.push(httpError(429, refusalBody))
      yield* ctx.prompt.prompt(text(ctx.chat.id, "do the work"))
      const parked = yield* ctx.pauses.get(ctx.chat.id)
      expect(parked?.error?.model).toEqual({ providerID: "test", modelID: "test-model" })

      yield* ctx.prompt.prompt(text(ctx.chat.id, "same route again"))
      const held = yield* ctx.pauses.get(ctx.chat.id)
      expect(held?.at).toBe(parked!.at)
      expect(held?.held).toHaveLength(1)
      expect(stepInputs(yield* ctx.llm.inputs)).toHaveLength(1)

      yield* ctx.llm.text("answered on the other model")
      yield* ctx.prompt.prompt(text(ctx.chat.id, "switch", { model: other }))
      yield* idle(ctx.chat.id)
      expect(yield* ctx.pauses.get(ctx.chat.id)).toBeUndefined()
      const inputs = stepInputs(yield* ctx.llm.inputs)
      expect(inputs.map((input) => input.model)).toEqual(["test-model", "other-model"])
      expect(answerTexts(yield* ctx.sessions.messages({ sessionID: ctx.chat.id }))).toEqual([
        "answered on the other model",
      ])
    }),
  { git: true },
  60_000,
)

it.instance(
  "an error that is not a refusal still ends the turn with the error and no pause",
  () =>
    Effect.gen(function* () {
      const ctx = yield* setup()
      yield* ctx.llm.error(400, { error: { type: "invalid_request_error", message: "invalid request: bad things" } })
      yield* ctx.prompt.prompt(text(ctx.chat.id, "do the work"))
      expect(stepInputs(yield* ctx.llm.inputs)).toHaveLength(1)
      expect(yield* ctx.pauses.get(ctx.chat.id)).toBeUndefined()
      const answers = assistants(yield* ctx.sessions.messages({ sessionID: ctx.chat.id }))
      expect(answers).toHaveLength(1)
      const error = answers[0].info.role === "assistant" ? answers[0].info.error : undefined
      expect(error?.name).toBe("APIError")
      expect(JSON.stringify(error)).toContain("invalid request: bad things")
    }),
  { git: true },
  60_000,
)

it.instance(
  "a rate limit without the refusal is still retried as before, and parks nothing",
  () =>
    Effect.gen(function* () {
      const ctx = yield* setup()
      yield* ctx.llm.push(
        raw({
          head: [
            streamChunk({ role: "assistant" }),
            {
              error: {
                type: "rate_limit_error",
                message: "Claude Max rate limit reached. Wait a moment and try again.",
              },
            },
          ],
        }),
      )
      yield* ctx.llm.text("recovered")
      const retries: GlobalEvent[] = []
      const listener = (event: GlobalEvent) => {
        if (event.payload?.type === "session.status" && event.payload.properties?.status?.type === "retry")
          retries.push(event)
      }
      GlobalBus.on("event", listener)
      yield* Effect.addFinalizer(() => Effect.sync(() => GlobalBus.off("event", listener)))
      yield* ctx.prompt.prompt(text(ctx.chat.id, "do the work"))
      expect(stepInputs(yield* ctx.llm.inputs)).toHaveLength(2)
      expect(retries.length).toBe(1)
      expect(yield* ctx.pauses.get(ctx.chat.id)).toBeUndefined()
      const answers = assistants(yield* ctx.sessions.messages({ sessionID: ctx.chat.id }))
      expect(answers).toHaveLength(1)
      expect(answers[0].info.role === "assistant" && answers[0].info.error).toBeUndefined()
    }),
  { git: true },
  60_000,
)
