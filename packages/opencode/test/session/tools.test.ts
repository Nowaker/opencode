import { expect } from "bun:test"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { setImmediate } from "node:timers/promises"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Agent } from "@/agent/agent"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { SessionProcessor } from "@/session/processor"
import { SessionTools } from "@/session/tools"
import { Tool } from "@/tool/tool"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { Plugin } from "@/plugin"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { Cause, Clock, Deferred, Effect, Layer, Schema } from "effect"
import { make } from "effect/testing/TestClock"
import { testEffect } from "../lib/effect"
import { snapshotMarkerTools } from "../fixture/snapshot-marker-tools"
import { TestConfig } from "../fixture/config"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"

const callID = "call-test"
const sessionID = SessionID.make("ses_test")
const messageID = MessageID.ascending()
const partID = PartID.ascending()

const agent: Agent.Info = {
  name: "build",
  mode: "primary",
  options: {},
  permission: [{ permission: "*", pattern: "*", action: "allow" }],
}

const model = {
  providerID: ProviderV2.ID.make("test"),
  api: { id: "test-model" },
} as Provider.Model

function fakeMcp() {
  return MCP.Service.of({
    tools: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
  } as Partial<MCP.Interface> as MCP.Interface)
}

const fakePlugin = Plugin.Service.of({
  init: () => Effect.void,
  list: () => Effect.succeed([]),
  trigger: (_name, _input, output) => Effect.succeed(output),
} satisfies Plugin.Interface)

const fakePermission = Permission.Service.of({
  ask: () => Effect.void,
  reply: () => Effect.void,
  list: () => Effect.succeed([]),
} satisfies Permission.Interface)

const fakeTruncate = Truncate.Service.of({
  cleanup: () => Effect.void,
  write: () => Effect.succeed("output.txt"),
  output: (text: string) => Effect.succeed({ content: text, truncated: false }),
  limits: () => Effect.succeed({ maxLines: 2000, maxBytes: 50 * 1024 }),
} satisfies Truncate.Interface)

const layer = Layer.mergeAll(
  Layer.succeed(Plugin.Service, fakePlugin),
  Layer.succeed(Permission.Service, fakePermission),
  Layer.succeed(MCP.Service, fakeMcp()),
  Layer.succeed(Truncate.Service, fakeTruncate),
  RuntimeFlags.layer(),
  TestConfig.layer(),
  Layer.succeed(
    ToolRegistry.Service,
    ToolRegistry.Service.of({
      ids: () => Effect.succeed(["timing"]),
      all: () => Effect.succeed([]),
      named: () => Effect.die("unused"),
      tools: () =>
        Effect.succeed([
          {
            id: "timing",
            description: "updates metadata more than once",
            parameters: Schema.Struct({}),
            jsonSchema: { type: "object", properties: {} },
            execute: (_args, ctx) =>
              Effect.gen(function* () {
                yield* ctx.metadata({ metadata: { output: "first" } })
                yield* ctx.metadata({ metadata: { output: "second" } })
                return { title: "timing", metadata: {}, output: "done" }
              }),
          } satisfies Tool.Def,
        ]),
    }),
  ),
)

const it = testEffect(layer)

it.effect("preserves running tool start time across metadata updates", () =>
  Effect.gen(function* () {
    const state: SessionV1.ToolPart = {
      id: partID,
      sessionID,
      messageID,
      type: "tool",
      tool: "timing",
      callID,
      state: {
        status: "running",
        input: {},
        time: { start: 100 },
      },
    }
    const updates: { start: number; output: unknown }[] = []
    const processor = {
      message: {
        id: messageID,
        sessionID,
        role: "assistant",
        parentID: MessageID.ascending(),
        agent: "build",
        mode: "build",
        path: { cwd: "/tmp", root: "/tmp" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: ModelV2.ID.make("test-model"),
        providerID: ProviderV2.ID.make("test"),
        time: { created: 1 },
      } satisfies SessionV1.Assistant,
      updateToolCall: (_toolCallID, update) =>
        Effect.sync(() => {
          const next = update(state)
          state.state = next.state
          if (state.state.status === "running") {
            updates.push({ start: state.state.time.start, output: state.state.metadata?.output })
          }
          return state
        }),
      completeToolCall: () => Effect.void,
      waitForSnapshots: Effect.void,
    } satisfies Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall" | "waitForSnapshots">

    const tools = yield* SessionTools.resolve({
      agent,
      model,
      session: { id: sessionID, permission: [] } as unknown as Session.Info,
      processor,
      bypassAgentCheck: false,
      messages: [],
      promptOps: {} as never,
    })
    const execute = tools.timing.execute
    if (!execute) throw new Error("timing tool is missing execute")

    yield* Effect.promise(() =>
      execute(
        {},
        {
          toolCallId: callID,
          abortSignal: new AbortController().signal,
          messages: [],
        },
      ),
    )

    expect(updates.filter(({ start }) => start !== 100)).toEqual([])
    expect(updates.flatMap(({ output }) => (output === undefined ? [] : [output]))).toEqual([
      "first",
      "second",
    ])
    expect(state.state.status).toBe("running")
    if (state.state.status === "running") {
      expect(state.state.time.start).toBe(100)
    }
  }),
)

function limitLayer(input: {
  config?: Partial<ConfigV1.Info>
  tools?: Tool.Def[]
  mcp?: Record<string, MCP.McpTool>
  ask?: Permission.Interface["ask"]
  plugin?: Plugin.Interface
}) {
  return Layer.mergeAll(
    Layer.succeed(Plugin.Service, input.plugin ?? fakePlugin),
    Layer.succeed(
      Permission.Service,
      Permission.Service.of({ ...fakePermission, ask: input.ask ?? fakePermission.ask }),
    ),
    Layer.succeed(
      MCP.Service,
      MCP.Service.of({
        tools: () => Effect.succeed(input.mcp ?? {}),
        clients: () => Effect.succeed({}),
      } as Partial<MCP.Interface> as MCP.Interface),
    ),
    Layer.succeed(Truncate.Service, fakeTruncate),
    RuntimeFlags.layer(),
    TestConfig.layer({ get: () => Effect.succeed(input.config ?? {}) }),
    Layer.succeed(
      ToolRegistry.Service,
      ToolRegistry.Service.of({
        ids: () => Effect.succeed((input.tools ?? []).map((tool) => tool.id)),
        all: () => Effect.succeed([]),
        named: () => Effect.die("unused"),
        tools: () => Effect.succeed(input.tools ?? []),
      }),
    ),
  )
}

const processorDefaults = {
  message: {
    id: messageID,
    sessionID,
    role: "assistant",
    parentID: MessageID.ascending(),
    agent: "build",
    mode: "build",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ModelV2.ID.make("test-model"),
    providerID: ProviderV2.ID.make("test"),
    time: { created: 1 },
  } satisfies SessionV1.Assistant,
  completeToolCall: () => Effect.void,
  waitForSnapshots: Effect.void,
} satisfies Pick<SessionProcessor.Handle, "message" | "completeToolCall" | "waitForSnapshots">

function makeLimitProcessor() {
  const parts = new Map<string, SessionV1.ToolPart>()
  return {
    ...processorDefaults,
    updateToolCall: (callID, update, tool) =>
      Effect.sync(() => {
        const part: SessionV1.ToolPart | undefined =
          parts.get(callID) ??
          (tool === undefined
            ? undefined
            : {
                id: PartID.ascending(),
                sessionID,
                messageID,
                type: "tool",
                tool,
                callID,
                state: { status: "pending", input: {}, raw: "" },
              })
        if (!part) return undefined
        const next = update(part)
        parts.set(callID, next)
        return next
      }),
  } satisfies Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall" | "waitForSnapshots">
}

const markSnapshotEffect = (name: string) =>
  InstanceState.directory.pipe(
    Effect.flatMap((directory) => Effect.promise(() => Bun.write(path.join(directory, `snapshot-marker-${name}`), ""))),
    Effect.asVoid,
  )

const snapshotPreflight = testEffect(
  LayerNode.compile(
    LayerNode.group([
      ToolRegistry.node,
      CrossSpawnSpawner.node,
      Config.node,
      Plugin.node,
      MCP.node,
      Permission.node,
      Truncate.node,
      RuntimeFlags.node,
    ]),
    [
      [Config.node, TestConfig.layer()],
      [RuntimeFlags.node, RuntimeFlags.layer()],
      [MCP.node, Layer.succeed(MCP.Service, fakeMcp())],
      [Truncate.node, Layer.succeed(Truncate.Service, fakeTruncate)],
      [
        Plugin.node,
        Layer.succeed(Plugin.Service, {
          ...fakePlugin,
          list: () => Effect.succeed([{ tool: snapshotMarkerTools }]),
          trigger: (name, _input, output) =>
            name === "tool.execute.before" || name === "shell.env"
              ? markSnapshotEffect(name).pipe(Effect.as(output))
              : Effect.succeed(output),
        } satisfies Plugin.Interface),
      ],
      [
        Permission.node,
        Layer.succeed(Permission.Service, {
          ...fakePermission,
          ask: () => markSnapshotEffect("permission"),
        }),
      ],
    ],
  ),
)

const checkSnapshotPreflight = (outcome: "timeout" | "abort") =>
  Effect.gen(function* () {
    const instance = yield* InstanceState.context
    const clock = yield* make()
    const startedAt = yield* Clock.currentTimeMillis
    yield* clock.setTime(startedAt)
    const release = yield* Deferred.make<void>()
    const requests = {
      snapshot_write_alpha: {},
      snapshot_write_beta: {},
      bash: { command: "echo ran >> snapshot-marker-bash", description: "Write the bash marker" },
    }
    const names = Object.keys(requests)
    const parts = new Map<string, SessionV1.ToolPart>(
      names.map((name) => [
        name,
        {
          id: PartID.ascending(),
          sessionID,
          messageID,
          type: "tool",
          tool: name,
          callID: name,
          state: { status: "running", input: {}, time: { start: 1 } },
        },
      ]),
    )
    const waiting = Promise.withResolvers<void>()
    let entered = 0
    const interruptedWaits: boolean[] = []
    const processor = {
      ...processorDefaults,
      message: { ...processorDefaults.message, path: { cwd: instance.directory, root: instance.worktree } },
      updateToolCall: (id, update) =>
        Effect.sync(() => {
          const part = parts.get(id)
          if (!part) throw new Error(`Unexpected tool call: ${id}`)
          const updated = update(part)
          parts.set(id, updated)
          return updated
        }),
      waitForSnapshots: Effect.sync(() => {
        if (++entered === names.length) waiting.resolve()
      }).pipe(
        Effect.andThen(Deferred.await(release)),
        Effect.onExit((exit) =>
          Effect.sync(() => {
            interruptedWaits.push(exit._tag === "Failure" && Cause.hasInterruptsOnly(exit.cause))
          }),
        ),
      ),
      skipSnapshot: (_signal, mark) => mark,
    } satisfies Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall" | "waitForSnapshots" | "skipSnapshot">
    const tools = yield* SessionTools.resolve({
      agent,
      model,
      session: {
        id: sessionID,
        slug: "test",
        projectID: instance.project.id,
        directory: instance.directory,
        title: "Snapshot preflight",
        version: "test",
        time: { created: 1, updated: 1 },
        permission: agent.permission,
      },
      processor,
      bypassAgentCheck: false,
      messages: [],
      promptOps: {
        cancel: () => Effect.void,
        resolvePromptParts: () => Effect.die("unexpected task tool"),
        prompt: () => Effect.die("unexpected task tool"),
      },
    }).pipe(Effect.provideService(Clock.Clock, clock))

    yield* Effect.promise(async () => {
      const bounded = async <A>(operation: Promise<A>, label: string) => {
        const deadline = Promise.withResolvers<never>()
        const timer = setTimeout(() => deadline.reject(new Error(label)), 1500)
        try {
          return await Promise.race([operation, deadline.promise])
        } finally {
          clearTimeout(timer)
        }
      }
      const markers = async () =>
        (await readdir(instance.directory)).filter((file) => file.startsWith("snapshot-marker-"))
      const written = () =>
        Promise.all(
          ["alpha", "beta", "bash"].map(async (name) =>
            (await Bun.file(path.join(instance.directory, `snapshot-marker-${name}`)).text()).trim().split(/\r?\n/),
          ),
        )
      const abort = new AbortController()
      const executions = Object.entries(requests).map(([name, args]) => {
        const execute = tools[name]?.execute
        if (!execute) throw new Error(`Missing ${name} from the tool registry`)
        return { name, args, execute }
      })
      const calls = Promise.allSettled(
        executions.map(async ({ name, args, execute }) =>
          execute(args, { toolCallId: name, abortSignal: abort.signal, messages: [] }),
        ),
      )
      try {
        await bounded(waiting.promise, "Not all three tools entered the snapshot wait")
        for (const [name, part] of parts) {
          expect({ name, state: part.state }).toMatchObject({
            name,
            state: {
              status: "running",
              metadata: { engine: { phase: "waiting-for-snapshot", snapshotWaitStartedAt: startedAt } },
            },
          })
        }
        expect(await markers()).toEqual([])

        if (outcome === "abort") {
          abort.abort()
          const outcomes = await bounded(calls, "Aborted calls did not reject while the snapshot was held")
          expect(outcomes.map(({ status }) => status)).toEqual(["rejected", "rejected", "rejected"])
          expect(interruptedWaits).toEqual([true, true, true])
          expect(Effect.runSync(Deferred.succeed(release, undefined))).toBe(true)
          await setImmediate()
          expect(await markers()).toEqual([])
          return
        }

        const waitMs = 120_000
        await bounded(Effect.runPromise(clock.adjust(waitMs)), "Could not advance the snapshot clock")
        const outcomes = await bounded(calls, "Tool execution did not finish while the snapshot was held")
        expect(outcomes.map(({ status }) => status)).toEqual(["fulfilled", "fulfilled", "fulfilled"])
        expect(interruptedWaits).toEqual([true, true, true])
        const expected = [["snapshot-marker-alpha"], ["snapshot-marker-beta"], ["ran"]]
        expect(await written()).toEqual(expected)
        for (const [name, part] of parts) {
          expect({ name, state: part.state }).toMatchObject({
            name,
            state: {
              status: "running",
              time: { start: 1 },
              metadata: {
                engine: {
                  phase: "running",
                  snapshot: "skipped",
                  snapshotWaitMs: waitMs,
                  executionStartedAt: startedAt + waitMs,
                },
              },
            },
          })
        }
        expect(Effect.runSync(Deferred.succeed(release, undefined))).toBe(true)
        await setImmediate()
        expect(await written()).toEqual(expected)
      } finally {
        abort.abort()
        Effect.runSync(Deferred.succeed(release, undefined))
        await bounded(calls, "Tool execution did not drain after releasing the fixture snapshot")
      }
    })
  })

snapshotPreflight.instance("write-capable tools dispatch once when snapshot preflight times out", () =>
  checkSnapshotPreflight("timeout"),
  12_000,
)

snapshotPreflight.instance("aborted snapshot preflight never dispatches write-capable tools", () =>
  checkSnapshotPreflight("abort"),
  12_000,
)

const callTool = Effect.fn("test.callTool")(function* (name: string, args: Record<string, unknown> = {}) {
  const tools = yield* SessionTools.resolve({
    agent,
    model,
    session: { id: sessionID, permission: [] } as unknown as Session.Info,
    processor: makeLimitProcessor(),
    bypassAgentCheck: false,
    messages: [],
    promptOps: {} as never,
  })
  const execute = tools[name]?.execute
  if (!execute) throw new Error(`${name} tool is missing execute`)
  return yield* Effect.promise(() =>
    Promise.resolve(
      execute(args, { toolCallId: callID, abortSignal: new AbortController().signal, messages: [] }),
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }),
    ),
  )
})

// A server whose tool never answers until the request is cancelled, the way a wedged worker behaves.
function hangingMcp(toolTimeout?: number | false) {
  const seen = { signal: undefined as AbortSignal | undefined }
  const tool: MCP.McpTool = {
    def: { name: "wait", description: "never answers", inputSchema: { type: "object", properties: {} } },
    client: {
      callTool: (_params: unknown, _schema: unknown, options: { signal?: AbortSignal }) => {
        seen.signal = options.signal
        return new Promise((_resolve, reject) =>
          options.signal?.addEventListener("abort", () => reject(options.signal?.reason)),
        )
      },
    } as unknown as MCP.McpTool["client"],
    server: "slow",
    toolTimeout,
  }
  return { seen, mcp: { slow_wait: tool } }
}

const mcpDeclared = hangingMcp(150)
testEffect(limitLayer({ mcp: mcpDeclared.mcp })).live("ends an MCP tool call at its server's tool_timeout", () =>
  Effect.gen(function* () {
    const result = yield* callTool("slow_wait")
    expect(result).toEqual({ ok: false, error: "tool call exceeded its 150ms limit (config: mcp.slow.tool_timeout)" })
    expect(mcpDeclared.seen.signal?.aborted).toBe(true)
  }),
)

const mcpOverridden = hangingMcp(false)
testEffect(limitLayer({ mcp: mcpOverridden.mcp, config: { tool_timeout: { slow_wait: 100 } } })).live(
  "a user's tool_timeout entry beats an MCP server's tool_timeout",
  () =>
    Effect.gen(function* () {
      const result = yield* callTool("slow_wait")
      expect(result).toEqual({
        ok: false,
        error: "tool call exceeded its 100ms limit (config: tool_timeout.slow_wait)",
      })
    }),
)

const hangingPlugin: Tool.Def = {
  id: "hang",
  description: "never finishes",
  parameters: Schema.Struct({}),
  jsonSchema: { type: "object", properties: {} },
  timeout: 100,
  execute: () => Effect.never,
}
testEffect(limitLayer({ tools: [hangingPlugin], config: { tool_timeout: { default: 60_000 } } })).live(
  "ends a hanging tool at its declared limit, not the global one",
  () =>
    Effect.gen(function* () {
      const result = yield* callTool("hang")
      expect(result).toEqual({ ok: false, error: "tool call exceeded its 100ms limit (tool default)" })
    }),
)

const asking: Tool.Def = {
  id: "asking",
  description: "waits on a permission prompt",
  parameters: Schema.Struct({}),
  jsonSchema: { type: "object", properties: {} },
  timeout: 100,
  execute: (_args, ctx) =>
    Effect.gen(function* () {
      yield* ctx.ask({ permission: "asking", patterns: ["*"], always: ["*"], metadata: {} })
      return { title: "", metadata: {}, output: "approved" }
    }),
}
testEffect(limitLayer({ tools: [asking], ask: () => Effect.promise(() => Bun.sleep(300)) })).live(
  "time waiting on a permission prompt does not count toward the limit",
  () =>
    Effect.gen(function* () {
      const result = yield* callTool("asking")
      expect(result.ok).toBe(true)
    }),
)

// Defers every tool but "asking", the way a plugin keeping rarely used tools behind tool search would.
const deferring = Plugin.Service.of({
  ...fakePlugin,
  trigger: (name, input, output) =>
    Effect.sync(() => {
      if (name === "tool.deferral" && (input as { toolID: string }).toolID !== "asking") {
        ;(output as { deferred: boolean }).deferred = true
      }
      return output
    }),
} satisfies Plugin.Interface)

const resolveFor = Effect.fn("test.resolveFor")(function* (
  npm: string,
  override?: {
    effective?: Agent.Info
    sessionPermission?: PermissionV1.Ruleset
    sourcePermission?: PermissionV1.Ruleset
  },
) {
  return yield* SessionTools.resolve({
    agent: override?.effective ?? agent,
    model: { ...model, api: { id: "test-model", npm } } as Provider.Model,
    session: { id: sessionID, permission: override?.sessionPermission ?? [] } as unknown as Session.Info,
    processor: makeLimitProcessor(),
    bypassAgentCheck: false,
    messages: [],
    promptOps: {} as never,
    sourcePermission: override?.sourcePermission,
  })
})

const deferralLayer = limitLayer({ tools: [hangingPlugin, asking], mcp: hangingMcp().mcp, plugin: deferring })

testEffect(deferralLayer).live("tool.deferral marks plugin and MCP tools defer_loading for both providers", () =>
  Effect.gen(function* () {
    const tools = yield* resolveFor("@ai-sdk/anthropic")
    for (const id of ["hang", "slow_wait"]) {
      expect(tools[id]?.providerOptions).toEqual({ anthropic: { deferLoading: true }, openai: { deferLoading: true } })
    }
    expect(tools.asking?.providerOptions).toBeUndefined()
    // Anthropic's search comes from the endpoint (Meridian), so opencode adds none.
    expect(Object.keys(tools).sort()).toEqual(["asking", "hang", "slow_wait"])
  }),
)

testEffect(deferralLayer).live("with OpenAI, a deferred tool brings the Responses tool_search", () =>
  Effect.gen(function* () {
    const tools = yield* resolveFor("@ai-sdk/openai")
    expect((tools.tool_search as { id?: string } | undefined)?.id).toBe("openai.tool_search")
  }),
)

testEffect(limitLayer({ tools: [asking] })).live("without the hook nothing is deferred and no search is added", () =>
  Effect.gen(function* () {
    const tools = yield* resolveFor("@ai-sdk/openai")
    expect(Object.keys(tools)).toEqual(["asking"])
    expect(tools.asking?.providerOptions).toBeUndefined()
  }),
)

const restrictedRead: Tool.Def = {
  ...asking,
  id: "read",
  execute: (_args, ctx) =>
    Effect.gen(function* () {
      yield* ctx.ask({ permission: "read", patterns: ["private.txt"], always: ["*"], metadata: {} })
      return { title: "Private", output: "private contents", metadata: {} }
    }),
}

testEffect(
  limitLayer({
    tools: [
      restrictedRead,
      { ...asking, id: "apply_patch" },
      { ...asking, id: "bash" },
      { ...asking, id: "task" },
      { ...asking, id: "execute" },
    ],
  }),
).live("swapped catalog excludes either agent's blanket denies and unqualified delegation despite session allows", () =>
  Effect.gen(function* () {
    const sourcePermission = [
      ...agent.permission,
      { permission: "edit", pattern: "*", action: "deny" },
    ] satisfies PermissionV1.Ruleset
    const effective = {
      ...agent,
      permission: [...agent.permission, { permission: "bash", pattern: "*", action: "deny" }],
    } satisfies Agent.Info
    const catalog = yield* resolveFor("@ai-sdk/openai", {
      effective,
      sourcePermission,
      sessionPermission: agent.permission,
    })
    expect(Object.keys(catalog)).toEqual(["read"])
  }),
)

for (const policy of ["source-deny", "effective-ask", "both-allow", "ordinary"] as const) {
  testEffect(limitLayer({ tools: [restrictedRead] })).live(`honors ${policy} on a pattern-specific tool call`, () =>
    Effect.gen(function* () {
      const rule = { permission: "read", pattern: "private.txt" } as const
      const sourcePermission: PermissionV1.Ruleset | undefined =
        policy === "ordinary"
          ? undefined
          : [...agent.permission, { ...rule, action: policy === "source-deny" ? "deny" : "allow" }]
      const effective: Agent.Info = {
        ...agent,
        permission: [
          ...agent.permission,
          { ...rule, action: policy === "effective-ask" || policy === "ordinary" ? "ask" : "allow" },
        ],
      }
      const catalog = yield* resolveFor("@ai-sdk/openai", {
        effective,
        sourcePermission,
        sessionPermission: agent.permission,
      })
      const execute = catalog.read?.execute
      if (!execute) throw new Error("scoped read should still be available for allowed paths")
      const result = yield* Effect.promise(() =>
        Promise.resolve(execute({}, { toolCallId: callID, messages: [] })).then(
          (output) => output,
          (error: unknown) => {
            if (error instanceof PermissionV1.DeniedError) return "denied"
            throw error
          },
        ),
      )
      if (policy === "source-deny" || policy === "effective-ask") {
        expect(result).toBe("denied")
        return
      }
      expect(result).toMatchObject({ output: "private contents" })
    }),
  )
}
