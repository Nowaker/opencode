import { expect } from "bun:test"
import { APICallError, tool } from "ai"
import { Clock, Effect, Layer, Stream } from "effect"
import { z } from "zod"
import path from "node:path"
import type { Agent } from "@/agent/agent"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { LLMEvent } from "@opencode-ai/llm"
import { EventV2Bridge } from "@/event-v2-bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MeridianRouting } from "@/provider/meridian-routing"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { SessionProcessor } from "@/session/processor"
import { MessageID } from "@/session/schema"
import { Session } from "@/session/session"
import { provideTmpdirInstance, tmpdirScoped } from "../fixture/fixture"
import { it as effectTest, testEffect } from "../lib/effect"

const routes = LayerNode.group([SessionProcessor.node, Session.node, Provider.node, EventV2Bridge.node, CrossSpawnSpawner.node])
const it = testEffect(LayerNode.compile(routes))
const claude = { providerID: ProviderV2.ID.make("anthropic-meridian"), modelID: ModelV2.ID.make("claude-alias") }
const chatgpt = { providerID: ProviderV2.ID.make("openai-meridian"), modelID: ModelV2.ID.make("gpt-alias") }
const wireClaude = "claude-wire"
const wireChatgpt = "gpt-5.5-wire"
const agent: Agent.Info = { name: "build", mode: "primary", options: {}, permission: [] }

function refusal(requestID: string | null, proof: Record<string, unknown> = {}) {
  return {
    type: "error",
    error: {
      type: "rate_limit_error",
      code: "no_routable_account",
      request_id: requestID,
      route_refusal: {
        version: 1,
        phase: "before_inference",
        sent: false,
        provider: "claude",
        model: wireClaude,
        reason: "quota_exhausted",
        ...proof,
      },
    },
  }
}

function serve(handle: (request: Request) => Response | Promise<Response>) {
  return Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handle })),
    (server) => Effect.promise(() => server.stop(true)),
  )
}

function fixture(url: URL, ref: typeof claude, wireVariant = "high") {
  return {
    config: {
      enabled_providers: [ref.providerID],
      provider: {
        [ref.providerID]: {
          npm: ref === claude ? "@ai-sdk/anthropic" : "@ai-sdk/openai",
          options: { baseURL: new URL("/v1", url).href, apiKey: "test-only" },
          models: {
            [ref.modelID]: {
              id: ref === claude ? wireClaude : wireChatgpt,
              name: ref.modelID,
              reasoning: true,
              tool_call: true,
              limit: { context: 100_000, output: 10_000 },
              variants: { high: ref === chatgpt ? { reasoningEffort: wireVariant } : { effort: wireVariant } },
            },
          },
        },
      },
    },
  }
}

const attempt = Effect.fnUntraced(function* (dir: string, ref: typeof claude, extra?: Partial<LLM.StreamInput>) {
  const sessions = yield* Session.Service
  const provider = yield* Provider.Service
  const processors = yield* SessionProcessor.Service
  const events = yield* EventV2Bridge.Service
  const model = yield* provider.getModel(ref.providerID, ref.modelID)
  const sessionID = (yield* sessions.create({})).id
  const user = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: { ...ref, variant: "high" },
    time: { created: Date.now() },
  })
  const assistant = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "build",
    agent: "build",
    path: { cwd: dir, root: dir },
    cost: 0,
    tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID: user.id,
    time: { created: Date.now() },
  })
  const errors: unknown[] = []
  const unlisten = yield* events.listen((event) =>
    Effect.sync(() => {
      if (event.type === Session.Event.Error.type) errors.push(event.data)
    }),
  )
  const handle = yield* processors.create({ assistantMessage: assistant, sessionID, model })
  const result = yield* handle.process({
    user,
    sessionID,
    model,
    agent,
    system: [],
    messages: [{ role: "user", content: "sensitive prompt" }],
    tools: {},
    ...extra,
  }).pipe(Effect.ensuring(unlisten))
  return { handle, result, errors }
})

it.live("binds trusted Claude refusals to fresh per-fetch IDs and the wire model, without a session error", () =>
  Effect.gen(function* () {
    const ids: (string | null)[] = []
    const server = yield* serve(async (request) => {
      const id = request.headers.get("x-request-id")
      ids.push(id)
      expect(request.headers.get("x-meridian-route-refusal")).toBe("1")
      const body: unknown = await request.json()
      expect(body).toMatchObject({ model: wireClaude })
      return Response.json(refusal(id), { status: 429 })
    })
    const url = new URL("/v1/messages", server.url).href
    yield* provideTmpdirInstance((dir) => Effect.gen(function* () {
      for (const index of [0, 1]) {
        const { handle, result, errors } = yield* attempt(dir, claude)
        const requestID = ids[index]
        if (!requestID) throw new Error("Expected a request ID on the trusted inference POST")
        expect(result).toBe("stop")
        expect(handle.routeRefusal).toEqual({ type: "claude", requestID, wireModel: wireClaude, variant: "high", reason: "quota_exhausted" })
        expect(handle.hasEffects).toBe(false)
        expect(handle.refusal?.code).toBe("no_routable_account")
        expect(errors).toEqual([])
      }
      const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/
      expect(ids).toEqual([expect.stringMatching(uuid), expect.stringMatching(uuid)])
      expect(new Set(ids).size).toBe(2)
    }), fixture(server.url, claude)).pipe(Effect.provideService(MeridianRouting.Trust, { claudeInferenceURL: url }))
  }),
)

for (const fault of ["none", "missing marker", "wrong variant", "wrong request", "wrong model"] as const) {
  it.live(`only accepts a GPT wire refusal bound to the exact request: ${fault}`, () =>
    Effect.gen(function* () {
      const requests: (string | null)[] = []
      const server = yield* serve(async (request) => {
        if (request.method === "GET") return Response.json({ data: [{ id: wireChatgpt }] })
        const id = request.headers.get("x-request-id")
        requests.push(id)
        expect(request.headers.get("x-meridian-route-refusal")).toBe("1")
        expect(await request.json()).toMatchObject({ model: wireChatgpt, reasoning: { effort: "high" } })
        return Response.json({
          error: {
            type: "rate_limit_error",
            code: "no_routable_account",
            request_id: fault === "wrong request" ? "stale-id" : id,
            route_refusal: {
              version: 1,
              phase: "before_inference",
              sent: false,
              provider: "chatgpt",
              model: fault === "wrong model" ? "other" : wireChatgpt,
              variant: fault === "wrong variant" ? "medium" : "high",
              reason: "quota_exhausted",
            },
          },
        }, { status: 429, headers: fault === "missing marker" ? undefined : { "x-meridian-route-refusal": "1" } })
      })
      const { handle } = yield* provideTmpdirInstance((dir) => attempt(dir, chatgpt), fixture(server.url, chatgpt)).pipe(
        Effect.provideService(MeridianRouting.Trust, {
          chatgptAvailabilityURL: new URL("/profiles/route-availability", server.url).href,
        }),
      )
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/)
      expect(handle.refusal?.code).toBe("no_routable_account")
      if (fault !== "none") {
        expect(handle.routeRefusal).toBeUndefined()
        return
      }
      expect(handle.routeRefusal).toMatchObject({ type: "chatgpt", requestID: requests[0], wireModel: wireChatgpt, variant: "high" })
    }),
  )
}

for (const fault of ["wrong id", "wrong model", "sent", "wrong path", "redirect"] as const) {
  it.live(`does not authorize a switch on Claude refusal with ${fault}`, () =>
    Effect.gen(function* () {
      let redirected = 0
      let redirectsSent = 0
      const server = yield* serve((request) => {
        const id = request.headers.get("x-request-id")
        const url = new URL(request.url)
        expect(request.headers.get("x-meridian-route-refusal")).toBe(fault === "wrong path" ? null : "1")
        if (fault === "redirect" && url.pathname === "/v1/messages") {
          redirectsSent++
          return Response.redirect(new URL("/redirected", url), 307)
        }
        if (url.pathname === "/redirected") redirected++
        return Response.json(refusal(
          fault === "wrong id" ? "stale-id" : id,
          fault === "wrong model" ? { model: claude.modelID } : fault === "sent" ? { sent: true } : {},
        ), { status: 429 })
      })
      const url = new URL(fault === "wrong path" ? "/v1/messages-other" : "/v1/messages", server.url).href
      const { handle } = yield* provideTmpdirInstance((dir) => attempt(dir, claude), fixture(server.url, claude)).pipe(
        Effect.provideService(MeridianRouting.Trust, { claudeInferenceURL: url }),
      )
      expect(handle.routeRefusal).toBeUndefined()
      expect(redirected).toBe(0)
      if (fault === "redirect") {
        expect(redirectsSent).toBe(1)
        expect(handle.message.error?.name).toBe("APIError")
        return
      }
      expect(handle.refusal?.code).toBe("no_routable_account")
    }),
  )
}

for (const outcome of ["allowed", "mapped effort", "sticky failure", "revoked", "budget rejected", "wire variant mismatch", "untrusted destination"] as const) {
  it.live(`fences the real alternate HTTP request when ${outcome}`, () =>
    Effect.gen(function* () {
      const requests: unknown[] = []
      const gates: string[] = []
      const server = yield* serve(async (request) => {
        if (request.method === "GET") return Response.json({ data: [{ id: wireChatgpt }] })
        requests.push(await request.json())
        return Response.json({ error: { message: "Alternate failed after dispatch" } }, { status: 400 })
      })
      const { handle, result, errors } = yield* provideTmpdirInstance((dir) => attempt(dir, chatgpt, {
        retries: outcome === "sticky failure" ? undefined : 0,
        small: outcome === "wire variant mismatch",
        agent: outcome === "wire variant mismatch" ? { ...agent, options: { reasoningEffort: "low" } } : agent,
        validateRequest: (prepared) => Effect.sync(() => {
          gates.push("validated")
          expect(prepared.messages).toContainEqual({ role: "user", content: "sensitive prompt" })
          return outcome !== "budget rejected"
        }),
        beforeDispatch: () => Effect.sync(() => {
          gates.push("decision")
          return outcome === "allowed" || outcome === "mapped effort" || outcome === "sticky failure" || outcome === "untrusted destination"
        }),
      }), fixture(server.url, chatgpt, outcome === "mapped effort" ? "medium" : "high")).pipe(
        Effect.provideService(MeridianRouting.Trust, {
          chatgptAvailabilityURL: outcome === "untrusted destination" ? undefined : new URL("/profiles/route-availability", server.url).href,
        }),
      )
      expect(result).toBe("stop")
      if (outcome === "allowed" || outcome === "mapped effort" || outcome === "sticky failure") {
        const expected = outcome === "mapped effort" ? "medium" : "high"
        expect(requests).toEqual([expect.objectContaining({ model: wireChatgpt, reasoning: expect.objectContaining({ effort: expected }) })])
        expect(gates).toEqual(["validated", "decision"])
        expect(handle.dispatchBlocked).toBe(false)
        expect(handle.message.error?.name).toBe("APIError")
        expect(errors).toHaveLength(outcome === "sticky failure" ? 1 : 0)
        return
      }
      expect(requests).toEqual([])
      expect(gates).toEqual(outcome === "revoked" ? ["validated", "decision"] : outcome === "budget rejected" ? ["validated"] : [])
      expect(handle.dispatchBlocked).toBe(true)
      expect(errors).toEqual([])
    }),
  )
}

for (const outcome of ["refused after dispatch", "mapped effort", "ordinary failure", "revoked", "budget rejected", "effort mismatch", "untrusted", "missing fence"] as const) {
  it.live(`fences the Claude preferred return when ${outcome}`, () =>
    Effect.gen(function* () {
      const requests: { id: string | null; body: unknown }[] = []
      const gates: string[] = []
      const server = yield* serve(async (request) => {
        expect(new URL(request.url).pathname).toBe("/v1/messages")
        expect(request.method).toBe("POST")
        expect(request.headers.get("x-api-key")).not.toBe("probe-test-key")
        expect(request.headers.get("x-meridian-route-refusal")).toBe("1")
        const id = request.headers.get("x-request-id")
        requests.push({ id, body: await request.json() })
        if (outcome === "refused after dispatch") return Response.json(refusal(id), { status: 429 })
        return Response.json({ type: "error", error: { type: "invalid_request_error", message: "Claude rejected the request" } }, { status: 400 })
      })
      const { handle, result, errors } = yield* provideTmpdirInstance(
        (dir) => attempt(dir, claude, {
          preferredReturn: true,
          retries: 0,
          small: outcome === "effort mismatch",
          agent: outcome === "effort mismatch" ? { ...agent, options: { effort: "low" } } : agent,
          validateRequest: (prepared) => Effect.sync(() => {
            gates.push("validated")
            expect(prepared.messages).toContainEqual({ role: "user", content: "sensitive prompt" })
            return outcome !== "budget rejected"
          }),
          beforeDispatch: outcome === "missing fence" ? undefined : () => Effect.sync(() => {
            gates.push("decision")
            return outcome !== "revoked"
          }),
        }),
        fixture(server.url, claude, outcome === "mapped effort" ? "medium" : "high"),
      ).pipe(Effect.provideService(MeridianRouting.Trust, {
        claudeInferenceURL: outcome === "untrusted" ? new URL("/wrong/v1/messages", server.url).href : new URL("/v1/messages", server.url).href,
        availabilityAPIKey: "probe-test-key",
      }))
      expect(result).toBe("stop")
      if (outcome === "refused after dispatch" || outcome === "mapped effort" || outcome === "ordinary failure") {
        const expected = outcome === "mapped effort" ? "medium" : "high"
        expect(gates).toEqual(["validated", "decision"])
        expect(requests).toEqual([{
          id: expect.stringMatching(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/),
          body: expect.objectContaining({ model: wireClaude, output_config: { effort: expected } }),
        }])
        expect(handle.dispatchBlocked).toBe(false)
        if (outcome === "refused after dispatch") {
          expect(handle.routeRefusal).toMatchObject({ requestID: requests[0].id, wireModel: wireClaude, variant: expected, reason: "quota_exhausted" })
          expect(errors).toEqual([])
          return
        }
        expect(handle.message.error?.name).toBe("APIError")
        expect(errors).toHaveLength(1)
        return
      }
      expect(requests).toEqual([])
      expect(gates).toEqual(outcome === "revoked" ? ["validated", "decision"] : outcome === "budget rejected" ? ["validated"] : [])
      expect(handle.dispatchBlocked).toBe(true)
      expect(errors).toEqual([])
    }),
  )
}

for (const effect of ["local dispatch", "hosted tool call", "visible text"] as const) {
  const refusalError = new APICallError({
    message: "No routable Claude account: exhausted",
    url: "http://127.0.0.1/v1/messages",
    requestBodyValues: undefined,
    statusCode: 429,
  })
  const replacement = Layer.succeed(LLM.Service, {
    stream: (input) => {
      switch (effect) {
        case "local dispatch":
          return Stream.fromEffectDrain(Effect.promise(async () => {
            await input.tools.lookup.execute?.({}, { toolCallId: "local", messages: [] })
          })).pipe(Stream.concat(Stream.fail(refusalError)))
        case "hosted tool call":
          return Stream.make(LLMEvent.toolCall({ id: "hosted", name: "lookup", input: {}, providerExecuted: true }))
            .pipe(Stream.concat(Stream.fail(refusalError)))
        case "visible text":
          return Stream.make(LLMEvent.textStart({ id: "text" }), LLMEvent.textDelta({ id: "text", text: "partial" }))
            .pipe(Stream.concat(Stream.fail(refusalError)))
      }
    },
  })
  const itEffects = testEffect(LayerNode.compile(routes, [[LLM.node, replacement]]))
  itEffects.live(`preserves proof of ${effect} when the refusal has no later stream events`, () =>
    Effect.gen(function* () {
      let calls = 0
      const { handle, errors } = yield* provideTmpdirInstance((dir) => attempt(dir, claude, {
        tools: { lookup: tool({ inputSchema: z.object({}), execute: async () => { calls++; return "done" } }) },
      }), fixture(new URL("http://127.0.0.1:1"), claude))
      expect(calls).toBe(effect === "local dispatch" ? 1 : 0)
      expect(handle.hasEffects).toBe(true)
      expect(handle.refusal?.code).toBe("no_routable_account")
      expect(errors).toEqual([])
    }),
  )
}

for (const ordering of ["before", "after"] as const) {
  const call = LLMEvent.toolCall({ id: "held", name: "lookup", input: { query: "held" } })
  const deferred = { reason: "paused", at: 400, switched: true }
  const result = LLMEvent.toolResult({
    id: "held",
    name: "lookup",
    result: { type: "json", value: { title: "", output: "", metadata: { deferred } } },
  })
  const llm = Layer.succeed(LLM.Service, {
    stream: () => Stream.fromIterable(ordering === "before" ? [result, call] : [call, result]),
  })
  testEffect(LayerNode.compile(LayerNode.group([routes, SessionProjector.node]), [
    [LLM.node, llm],
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
  ])).live(
    `persists the switched deferral marker when the result arrives ${ordering} the tool call`,
    () => provideTmpdirInstance((dir) => Effect.gen(function* () {
      const session = yield* Session.Service
      const { handle } = yield* attempt(dir, claude)
      const messages = yield* session.messages({ sessionID: handle.message.sessionID })
      const held = messages.flatMap((message) => message.parts).find((part) => part.type === "tool" && part.callID === "held")
      expect(held).toMatchObject({ state: { status: "pending", input: { query: "held" }, metadata: { deferred } } })
    }), fixture(new URL("http://127.0.0.1:1"), claude)),
  )
}

for (const fault of ["none", "wrong variant", "wrong model", "depleted", "stale", "future", "redirect"] as const) {
  effectTest.live(`ChatGPT availability is ${fault === "none" ? "accepted for the exact fresh tuple" : `rejected for ${fault}`}`, () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      let redirected = 0
      const server = yield* serve((request) => {
        const url = new URL(request.url)
        if (url.pathname === "/redirected") redirected++
        if (fault === "redirect" && url.pathname !== "/redirected") return Response.redirect(new URL("/redirected", url))
        expect(request.method).toBe("GET")
        expect(request.body).toBeNull()
        expect(Object.fromEntries(url.searchParams)).toEqual({ provider: "chatgpt", model: wireChatgpt, variant: "high" })
        return Response.json({
          version: 1,
          provider: "chatgpt",
          model: fault === "wrong model" ? chatgpt.modelID : wireChatgpt,
          variant: fault === "wrong variant" ? "medium" : "high",
          available: true,
          routable_allotment: fault === "depleted" ? 0 : 1,
          observed_at: fault === "stale" ? now - 30_001 : fault === "future" ? now + 60_000 : now,
        })
      })
      const available = yield* MeridianRouting.probe({
        model: {
          providerID: chatgpt.providerID,
          api: { id: wireChatgpt, npm: "@ai-sdk/openai", url: "" },
          variants: { portable: { reasoningEffort: "high" } },
        },
        variant: "portable",
      })
        .pipe(Effect.provideService(MeridianRouting.Trust, {
          chatgptAvailabilityURL: new URL("/profiles/route-availability", server.url).href,
        }))
      expect(available).toBe(fault === "none" ? now + 30_000 : undefined)
      expect(redirected).toBe(0)
    }),
  )
}

for (const fault of ["none", "wrong provider", "redirect", "unregistered", "default"] as const) {
  effectTest.live(`Claude availability uses a private exact-route GET when ${fault}`, () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const paths: string[] = []
      const server = yield* serve((request) => {
        const url = new URL(request.url)
        paths.push(url.pathname)
        if (url.pathname === "/redirected") {
          return new Response(null, { status: 404 })
        }
        expect(url.pathname).toBe("/proxy/profiles/route-availability")
        expect(request.method).toBe("GET")
        expect(request.body).toBeNull()
        expect(request.headers.get("x-api-key")).toBe("probe-test-key")
        expect(Object.fromEntries(url.searchParams)).toEqual({ provider: "claude", model: wireClaude, variant: "high" })
        if (fault === "redirect") return Response.redirect(new URL("/redirected", url))
        return Response.json({
          version: 1, provider: fault === "wrong provider" ? "chatgpt" : "claude",
          model: wireClaude, variant: "high", available: true, routable_allotment: 1, observed_at: now,
        })
      })
      const available = yield* MeridianRouting.probe({
        provider: "claude",
        model: {
          providerID: claude.providerID,
          api: { id: wireClaude, npm: "@ai-sdk/anthropic", url: "" },
          variants: { portable: { effort: "high" } },
        },
        variant: fault === "default" ? null : fault === "unregistered" ? "high" : "portable",
      }).pipe(Effect.provideService(MeridianRouting.Trust, {
        claudeInferenceURL: new URL("/proxy/v1/messages", server.url).href,
        chatgptAvailabilityURL: new URL("/proxy/profiles/route-availability", server.url).href,
        availabilityAPIKey: "probe-test-key",
      }))
      expect(available).toBe(fault === "none" ? now + 30_000 : undefined)
      expect(paths).toEqual(fault === "unregistered" || fault === "default" ? [] : ["/proxy/profiles/route-availability"])
    }),
  )
}

it.live("uses the managed startup URLs and private probe key for the preferred status preview", () =>
  Effect.gen(function* () {
    const requests: { path: string; key: string | null; query: Record<string, string> }[] = []
    const server = yield* serve((request) => {
      const url = new URL(request.url)
      requests.push({ path: url.pathname, key: request.headers.get("x-api-key"), query: Object.fromEntries(url.searchParams) })
      return Response.json({
        version: 1, provider: "claude", model: "claude-opus-5-5", variant: "high",
        available: true, routable_allotment: 1, observed_at: Date.now(),
      })
    })
    const moduleFile = path.join(yield* tmpdirScoped(), "policy.mjs")
    const bases = { claudeBaseURL: new URL("/claude", server.url).href, chatgptBaseURL: new URL("/chatgpt", server.url).href }
    yield* Effect.promise(() => Bun.write(moduleFile, `export const readAutoSwitchMeridianTrust = () => (${JSON.stringify(bases)})`))
    const child = yield* Effect.acquireRelease(
      Effect.sync(() => Bun.spawn({
        cmd: [process.execPath, "--eval", `
          import { Effect } from "effect"
          import { MeridianRouting } from "./src/provider/meridian-routing"
          const result = await Effect.runPromise(MeridianRouting.probe({
            provider: "claude",
            model: {
              providerID: "anthropic-meridian",
              api: { id: "claude-opus-5-5", npm: "@ai-sdk/anthropic", url: "" },
              variants: { high: { effort: "high" } },
            },
            variant: "high",
          }))
          if (result === undefined) process.exitCode = 1
        `],
        env: { VIBETERM_AUTO_SWITCH_POLICY_MODULE: moduleFile, MERIDIAN_API_KEY: "startup-probe-test-key" },
        stdout: "ignore",
      })),
      (child) => Effect.sync(() => { if (child.exitCode === null) child.kill() }),
    )
    expect(yield* Effect.promise(() => child.exited)).toBe(0)
    expect(requests).toEqual([{
      path: "/chatgpt/profiles/route-availability", key: "startup-probe-test-key",
      query: { provider: "claude", model: "claude-opus-5-5", variant: "high" },
    }])
  }),
)
