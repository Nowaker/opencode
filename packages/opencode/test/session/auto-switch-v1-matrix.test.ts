import { expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import type { ConfigProviderV1 } from "@opencode-ai/core/v1/config/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Context, Effect, Schema } from "effect"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { MeridianRouting } from "@/provider/meridian-routing"
import { AutoSwitch } from "@/session/auto-switch"
import { SessionPause } from "@/session/pause"
import { SessionPrompt } from "@/session/prompt"
import { MessageID, type SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { Todo } from "@/session/todo"
import { TestConfig } from "../fixture/config"
import { createProviderFixture } from "../fixture/phase2-provider-fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"

const MatrixConfig = Context.Reference<ConfigV1.Info>("test/AutoSwitchMatrixConfig", { defaultValue: () => ({}) })
const it = testEffect(AppNodeBuilder.build(
  LayerNode.group([SessionPrompt.node, Session.node, SessionStatus.node, SessionPause.node, SessionProjector.node, Ripgrep.node, EventV2Bridge.node]),
  [
    [Config.node, TestConfig.layer({ get: () => MatrixConfig })],
    [RuntimeFlags.node, RuntimeFlags.layer({ pure: true, disableDefaultPlugins: true, experimentalEventSystem: true })],
  ],
))
const gpt = {
  agent: "build", providerID: ProviderV2.ID.make("openai"), modelID: ModelV2.ID.make("gpt-6.2-sol"), variant: "xhigh",
} as const
const gptMax = { ...gpt, variant: "max" } as const
const claude = {
  agent: "build", providerID: ProviderV2.ID.make("anthropic"), modelID: ModelV2.ID.make("claude-opus-5-5"), variant: "high",
} as const
type Route = { readonly agent: string; readonly providerID: ProviderV2.ID; readonly modelID: ModelV2.ID; readonly variant: string }

const reverseFamilies = [
  ["gpt-6.2-astra", "high", "claude-fable-5-2", "high"],
  ["gpt-6.1-terra", "medium", "claude-sonnet-5-5", "high"],
  ["gpt-6-luna", "low", "claude-haiku-5-5", "low"],
  ["gpt-6-luna-fast", "low", "claude-haiku-5-5", "low"],
] as const

const gptReasoning = { text: "matrix-gpt-private-reasoning", encryptedContent: "matrix-gpt-encrypted-blob" } as const
const claudeReasoning = { text: "matrix-claude-private-thinking", signature: "matrix-claude-signature" } as const
const toolInput = { todos: [{ content: "matrix-tool-result", status: "completed", priority: "high" }] } as const
const toolOutput = JSON.stringify(toolInput.todos, null, 2)
const gptTool = { name: "todowrite", input: toolInput, id: "call_matrix_native_gpt" } as const
const claudeTool = { ...gptTool, id: "toolu_matrix_native_claude" } as const
const refusal = { refusal: "quota_exhausted" } as const
const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"

const setup = Effect.fnUntraced(function* (fixtureOptions: {
  readonly claudeInputLimit?: number
  readonly pinnedProfile?: string
  readonly routes?: { readonly source: Route; readonly target: Route }
  readonly disableClaudeEffort?: boolean
} = {}) {
  const openai = fixtureOptions.routes?.source ?? gpt
  const anthropic = fixtureOptions.routes?.target ?? claude
  const fixture = yield* Effect.acquireRelease(
    Effect.sync(() => createProviderFixture(openai.modelID)),
    (server) => Effect.promise(() => server.close()),
  )
  const options = { apiKey: "fixture-only", baseURL: new URL("/v1", fixture.url).href }
  const model = {
    reasoning: true,
    attachment: true,
    tool_call: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 256_000, output: 10_000 },
  } satisfies typeof ConfigProviderV1.Model.Type
  const config = {
    snapshot: false,
    compaction: { auto: false },
    enabled_providers: [gpt.providerID, claude.providerID],
    provider: {
      [openai.providerID]: {
        npm: "@ai-sdk/openai", options,
        models: { [openai.modelID]: {
          ...model, options: { store: false }, variants: {
            [openai.variant]: { reasoningEffort: openai.variant }, max: { reasoningEffort: "max" },
          },
          headers: fixtureOptions.pinnedProfile ? { "x-meridian-profile": fixtureOptions.pinnedProfile } : undefined,
        } },
      },
      [anthropic.providerID]: {
        npm: "@ai-sdk/anthropic", options,
        models: { [anthropic.modelID]: {
          ...model, limit: { ...model.limit, input: fixtureOptions.claudeInputLimit }, variants: {
            [anthropic.variant]: { effort: anthropic.variant, disabled: fixtureOptions.disableClaudeEffort },
          },
        } },
      },
    },
  } satisfies Partial<ConfigV1.Info>
  const sessions = yield* Session.Service
  const prompts = yield* SessionPrompt.Service
  const session = yield* sessions.create({ title: "Meridian routing matrix", permission: [{ permission: "*", pattern: "*", action: "allow" }] })
    .pipe(Effect.provideService(MatrixConfig, config))
  const submit = (input: SessionPrompt.PromptInput) => prompts.prompt(input).pipe(
    Effect.provideService(MatrixConfig, config),
    Effect.provideService(AutoSwitch.Owner, () => session.id),
    Effect.provideService(AutoSwitch.Policy, ({ source }) => ({
      enabled: true,
      reason: "default-on",
      policyRevision: "matrix",
      alternates: source?.providerID === anthropic.providerID ? [openai] : [anthropic],
      returnEnabled: true,
    })),
    Effect.provideService(MeridianRouting.Trust, {
      claudeInferenceURL: new URL("/v1/messages", fixture.url).href,
      chatgptAvailabilityURL: new URL("/profiles/route-availability", fixture.url).href,
    }),
  )
  return { fixture, sessionID: session.id, sessions, submit }
})

function submission(sessionID: SessionID, model: Route, text: string) {
  return { sessionID, messageID: MessageID.ascending(), model, agent: model.agent, variant: model.variant, parts: [{ type: "text", text }] } satisfies SessionPrompt.PromptInput
}

function expectAnswer(result: SessionV1.WithParts, model: Route, parentID: MessageID, answer: string) {
  expect(result.info).toMatchObject({ role: "assistant", parentID, ...model })
  if (result.info.role === "assistant") expect(result.info.error).toBeUndefined()
  expect(result.parts.filter((part) => part.type === "text").map((part) => part.text)).toEqual([answer])
}

function userIDs(messages: readonly SessionV1.WithParts[]) {
  return messages.filter((entry) => entry.info.role === "user").map((entry) => entry.info.id)
}

function expectPosts(fixture: ReturnType<typeof createProviderFixture>, paths: readonly string[]) {
  expect(fixture.unexpected).toEqual([])
  const requests = fixture.captured.filter((request) => request.method === "POST")
  expect(requests.map((request) => request.path)).toEqual([...paths])
  return requests
}

const anthropicMessages = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({
  role: Schema.String,
  content: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
})))

const awaitFreshAdmission = Effect.fnUntraced(function* (sessionID: SessionID) {
  const statuses = yield* SessionStatus.Service
  const idle = yield* pollWithTimeout(statuses.get(sessionID).pipe(
    Effect.map((status) => status.type === "idle" ? Date.now() : undefined),
  ), "Session did not become idle after the alternate completed")
  // Admission must be newer than idle at the engine's millisecond resolution.
  yield* pollWithTimeout(Effect.sync(() => Date.now() > idle ? true : undefined), "Clock did not advance past idle")
})

it.instance("switches the same GPT tool continuation to Claude without repeating the tool or changing the user turn", () =>
  Effect.gen(function* () {
    const ctx = yield* setup()
    ctx.fixture.enqueue("openai", { reasoning: gptReasoning, tool: gptTool }, refusal)
    ctx.fixture.enqueue("anthropic", { text: "Claude completed the original turn" })
    const input = submission(ctx.sessionID, gpt, "Write the fixture todo once and report its result.")
    const events = yield* EventV2Bridge.Service
    const writes: (readonly Todo.Info[])[] = []
    yield* Effect.acquireRelease(events.listen((event) => Effect.sync(() => {
      if (event.type !== Todo.Event.Updated.type) return
      const data = Schema.decodeUnknownSync(Todo.Event.Updated.data)(event.data)
      if (data.sessionID === ctx.sessionID) writes.push(data.todos)
    })), (unlisten) => unlisten)

    const result = yield* ctx.submit(input)

    const messages = yield* ctx.sessions.messages({ sessionID: ctx.sessionID })
    const parts = messages.flatMap((entry) => entry.parts)
    expect(parts.filter((part) => part.type === "reasoning")).toMatchObject([{
      text: gptReasoning.text, metadata: { openai: { reasoningEncryptedContent: gptReasoning.encryptedContent } },
    }])
    expect(parts.filter((part) => part.type === "tool")).toMatchObject([{
      tool: gptTool.name, callID: gptTool.id, state: { status: "completed", input: toolInput, output: toolOutput },
    }])
    expect(writes).toEqual([toolInput.todos])
    const [, refused, alternate] = expectPosts(ctx.fixture, ["/v1/responses", "/v1/responses", "/v1/messages"])
    expect(refused?.headers).toMatchObject({ "x-meridian-route-refusal": "1", "x-request-id": expect.stringMatching(uuid) })
    expect(refused?.body).toMatchObject({ model: gpt.modelID, reasoning: { effort: gpt.variant }, input: expect.arrayContaining([
      expect.objectContaining({ type: "function_call_output", call_id: gptTool.id, output: toolOutput }),
    ]) })
    expect(alternate?.body).toMatchObject({ model: claude.modelID, output_config: { effort: claude.variant } })
    const wire = anthropicMessages(alternate?.body.messages)
    expect(wire.map((message) => message.role)).toEqual(["user", "assistant", "user"])
    expect(wire[0].content.find((block) => block.type === "text")).toMatchObject({ text: input.parts[0].text })
    expect(wire[1].content.find((block) => block.type === "tool_use")).toMatchObject({ id: "call_portable_1", name: gptTool.name, input: toolInput })
    expect(wire[2].content.find((block) => block.type === "tool_result")).toMatchObject({ tool_use_id: "call_portable_1", content: toolOutput })
    expect(JSON.stringify(alternate?.body)).not.toMatch(/matrix-gpt-private-reasoning|matrix-gpt-encrypted-blob|call_matrix_native_gpt/)
    expectAnswer(result, claude, input.messageID, "Claude completed the original turn")
    expect(userIDs(messages)).toEqual([input.messageID])
    const current = yield* ctx.sessions.get(ctx.sessionID)
    expect(AutoSwitch.preferred(current)).toEqual(gpt)
    expect(AutoSwitch.stored(current).episode).toMatchObject({ source: gpt, target: claude, step: 2, turnID: input.messageID, state: "active" })
  }),
)

it.instance("returns to Claude on the next idle prompt with the completed Claude tool exchange and no private reasoning", () =>
  Effect.gen(function* () {
    const ctx = yield* setup()
    ctx.fixture.enqueue("anthropic", { reasoning: claudeReasoning, tool: claudeTool }, "Claude fixture complete", refusal, "Claude returned")
    ctx.fixture.enqueue("openai", { reasoning: gptReasoning, text: "GPT alternate answer" })
    const first = submission(ctx.sessionID, claude, "Run the Claude fixture tool.")
    expectAnswer(yield* ctx.submit(first), claude, first.messageID, "Claude fixture complete")
    const switched = submission(ctx.sessionID, claude, "Use the completed fixture result.")
    expectAnswer(yield* ctx.submit(switched), gpt, switched.messageID, "GPT alternate answer")
    yield* awaitFreshAdmission(ctx.sessionID)
    const next = submission(ctx.sessionID, claude, "Continue with the completed result and prior reply.")

    const result = yield* ctx.submit(next)

    expectAnswer(result, claude, next.messageID, "Claude returned")
    const messages = yield* ctx.sessions.messages({ sessionID: ctx.sessionID })
    expect(userIDs(messages)).toEqual([first.messageID, switched.messageID, next.messageID])
    const current = yield* ctx.sessions.get(ctx.sessionID)
    expect(AutoSwitch.preferred(current)).toEqual(claude)
    expect(AutoSwitch.stored(current).episode).toMatchObject({ state: "returned", autoReturnedTurnID: next.messageID })
    expect(messages.flatMap((entry) => entry.parts).filter((part) => part.type === "reasoning")).toMatchObject([
      { text: claudeReasoning.text, metadata: { anthropic: { signature: claudeReasoning.signature } } },
      { text: gptReasoning.text, metadata: { openai: { reasoningEncryptedContent: gptReasoning.encryptedContent } } },
    ])
    const [, , , alternate, returning] = expectPosts(ctx.fixture, ["/v1/messages", "/v1/messages", "/v1/messages", "/v1/responses", "/v1/messages"])
    expect(alternate?.body).toMatchObject({ model: gpt.modelID, reasoning: { effort: gpt.variant }, input: expect.arrayContaining([
      expect.objectContaining({ type: "function_call", name: claudeTool.name, call_id: "call_portable_1", arguments: JSON.stringify(toolInput) }),
      expect.objectContaining({ type: "function_call_output", call_id: "call_portable_1", output: toolOutput }),
    ]) })
    expect(JSON.stringify(alternate?.body)).not.toMatch(/matrix-claude-private-thinking|matrix-claude-signature|toolu_matrix_native_claude/)
    expect(returning?.body).toMatchObject({ model: claude.modelID, output_config: { effort: claude.variant } })
    const blocks = anthropicMessages(returning?.body.messages).flatMap((message) => message.content)
    expect(blocks.find((block) => block.type === "tool_use")).toMatchObject({ id: "call_portable_1", name: claudeTool.name, input: toolInput })
    expect(blocks.find((block) => block.type === "tool_result")).toMatchObject({ tool_use_id: "call_portable_1", content: toolOutput })
    expect(blocks.filter((block) => block.type === "text").map((block) => block.text)).toEqual(expect.arrayContaining([
      "GPT alternate answer", next.parts[0].text,
    ]))
    expect(JSON.stringify(returning?.body)).not.toMatch(/matrix-(?:gpt-private-reasoning|gpt-encrypted-blob|claude-private-thinking|claude-signature)|toolu_matrix_native_claude/)
  }),
)

it.instance("returns to the exact preferred GPT Sol max wire after a Claude alternate and a fresh idle prompt", () =>
  Effect.gen(function* () {
    const ctx = yield* setup()
    ctx.fixture.enqueue("openai", refusal, "GPT max returned")
    ctx.fixture.enqueue("anthropic", "Claude alternate answer")
    const first = submission(ctx.sessionID, gptMax, "Start on GPT Sol max.")
    expectAnswer(yield* ctx.submit(first), claude, first.messageID, "Claude alternate answer")
    yield* awaitFreshAdmission(ctx.sessionID)
    const next = submission(ctx.sessionID, gptMax, "Continue on the original route.")

    const result = yield* ctx.submit(next)

    expectAnswer(result, gptMax, next.messageID, "GPT max returned")
    const current = yield* ctx.sessions.get(ctx.sessionID)
    expect(AutoSwitch.preferred(current)).toEqual(gptMax)
    expect(AutoSwitch.stored(current).episode).toMatchObject({ source: gptMax, target: claude, state: "returned", autoReturnedTurnID: next.messageID })
    const [source, , returning] = expectPosts(ctx.fixture, ["/v1/responses", "/v1/messages", "/v1/responses"])
    for (const request of [source, returning]) {
      expect(request?.body).toMatchObject({ model: gptMax.modelID, reasoning: { effort: "max" } })
    }
    expect(ctx.fixture.captured.filter((request) => request.wire === "availability").map((request) => request.query)).toEqual([
      { provider: "claude", model: claude.modelID, variant: claude.variant },
      { provider: "chatgpt", model: gptMax.modelID, variant: "max" },
    ])
  }),
)

it.instance("preserves a supported inline PNG on the GPT-to-Claude replacement wire", () =>
  Effect.gen(function* () {
    const ctx = yield* setup()
    ctx.fixture.enqueue("openai", refusal)
    ctx.fixture.enqueue("anthropic", "Claude handled the image turn")
    const input = submission(ctx.sessionID, gpt, "Describe this pixel.")
    const image = { type: "file", mime: "image/png", url: `data:image/png;base64,${png}` } as const

    const result = yield* ctx.submit({ ...input, parts: [...input.parts, image] })

    const [source, alternate] = expectPosts(ctx.fixture, ["/v1/responses", "/v1/messages"])
    expect(source?.body).toMatchObject({ input: expect.arrayContaining([
      expect.objectContaining({ role: "user", content: expect.arrayContaining([expect.objectContaining({ type: "input_image", image_url: image.url })]) }),
    ]) })
    const wire = anthropicMessages(alternate?.body.messages)
    expect(wire.map((message) => message.role)).toEqual(["user"])
    expect(wire[0].content).toMatchObject([
      { type: "text", text: input.parts[0].text }, { type: "image", source: { type: "base64", media_type: "image/png", data: png } },
    ])
    expectAnswer(result, claude, input.messageID, "Claude handled the image turn")
  }),
)

for (const [sourceID, sourceEffort, targetID, targetEffort] of reverseFamilies) {
  it.instance(`switches ${sourceID} to the approved ${targetID} effort and returns to its exact saved GPT route`, () =>
    Effect.gen(function* () {
      const source = { ...gpt, modelID: ModelV2.ID.make(sourceID), variant: sourceEffort }
      const target = { ...claude, modelID: ModelV2.ID.make(targetID), variant: targetEffort }
      const ctx = yield* setup({ routes: { source, target } })
      ctx.fixture.enqueue("openai", refusal, "GPT preferred returned")
      ctx.fixture.enqueue("anthropic", "Claude alternate completed")
      const first = submission(ctx.sessionID, source, "Continue using the approved alternate if needed.")

      expectAnswer(yield* ctx.submit(first), target, first.messageID, "Claude alternate completed")
      yield* awaitFreshAdmission(ctx.sessionID)
      const next = submission(ctx.sessionID, source, "Continue on the saved route.")
      expectAnswer(yield* ctx.submit(next), source, next.messageID, "GPT preferred returned")

      const [original, alternate, returning] = expectPosts(ctx.fixture, ["/v1/responses", "/v1/messages", "/v1/responses"])
      expect(original?.body).toMatchObject({ model: sourceID, reasoning: { effort: sourceEffort } })
      expect(alternate?.body).toMatchObject({ model: targetID, output_config: { effort: targetEffort } })
      expect(returning?.body).toMatchObject({ model: sourceID, reasoning: { effort: sourceEffort } })
      expect(ctx.fixture.captured.filter((request) => request.wire === "availability").map((request) => request.query)).toEqual([
        { provider: "claude", model: targetID, variant: targetEffort },
        { provider: "chatgpt", model: sourceID, variant: sourceEffort },
      ])
      expect(userIDs(yield* ctx.sessions.messages({ sessionID: ctx.sessionID }))).toEqual([first.messageID, next.messageID])
      expect(AutoSwitch.preferred(yield* ctx.sessions.get(ctx.sessionID))).toEqual(source)
    }),
  )
}

it.instance("parks a Luna refusal when Haiku lacks the approved explicit effort", () =>
  Effect.gen(function* () {
    const source = { ...gpt, modelID: ModelV2.ID.make("gpt-6-luna"), variant: "low" }
    const target = { ...claude, modelID: ModelV2.ID.make("claude-haiku-5-5"), variant: "low" }
    const ctx = yield* setup({ routes: { source, target }, disableClaudeEffort: true })
    ctx.fixture.enqueue("openai", refusal)

    yield* ctx.submit(submission(ctx.sessionID, source, "Use only approved effort."))

    expectPosts(ctx.fixture, ["/v1/responses"])
    expect(ctx.fixture.captured.filter((request) => request.wire === "availability")).toEqual([])
    const pauses = yield* SessionPause.Service
    const pause = yield* pauses.get(ctx.sessionID)
    expect(pause?.error).toMatchObject({ code: "no_routable_account", model: {
      providerID: source.providerID, modelID: source.modelID,
    } })
  }),
)

for (const cause of ["unsupported-output", "context-budget", "missing response marker", "profile pin"] as const) {
  it.instance(`parks for ${cause} without sending an alternate request`, () =>
    Effect.gen(function* () {
      const pinnedProfile = cause === "profile pin" ? "matrix-profile" : undefined
      const ctx = yield* setup({ claudeInputLimit: cause === "context-budget" ? 128 : undefined, pinnedProfile })
      ctx.fixture.enqueue("openai", { ...refusal, omitResponseMarker: cause === "missing response marker", ordinaryRefusal: pinnedProfile !== undefined })
      const input = submission(ctx.sessionID, gpt, "Return an answer without changing the requirements.")
      const format = cause === "unsupported-output"
        ? new SessionV1.OutputFormatJsonSchema({ type: "json_schema", schema: { type: "object", properties: { answer: { type: "number" } }, required: ["answer"] }, retryCount: 0 })
        : undefined

      yield* ctx.submit({ ...input, format })

      const [source] = expectPosts(ctx.fixture, ["/v1/responses"])
      const pauses = yield* SessionPause.Service
      const pause = yield* pauses.get(ctx.sessionID)
      expect(pause?.error).toMatchObject({
        code: "no_routable_account", model: { providerID: gpt.providerID, modelID: gpt.modelID },
      })
      if (pinnedProfile) {
        expect(source?.headers["x-meridian-profile"]).toBe(pinnedProfile)
        expect(source?.headers["x-meridian-route-refusal"]).toBeUndefined()
        expect(source?.headers["x-request-id"]).toBeUndefined()
      } else {
        expect(pause?.error?.request_id).toEqual(expect.stringMatching(uuid))
        expect(source?.headers["x-request-id"]).toBe(pause?.error?.request_id)
      }
      if (cause === "missing response marker" || pinnedProfile) {
        expect(ctx.fixture.captured.filter((request) => request.wire === "availability")).toEqual([])
        expect(pause?.reason).not.toContain("Claude")
        return
      }
      expect(pause?.reason).toContain(cause)
    }),
  )
}
