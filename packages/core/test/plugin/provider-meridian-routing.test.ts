import { expect } from "bun:test"
import { ai } from "@opencode/ai/effect"
import { Anthropic, OpenAI } from "@opencode/ai/providers"
import { LLMClient, RequestExecutor, type StreamOptions } from "@opencode/ai/route"
import { MeridianRouting } from "@opencode/core/plugin/provider/meridian-routing"
import { Clock, Effect, Layer, Result, Schema, Stream } from "effect"
import { HttpClientRequest } from "effect/http"
import { testEffect } from "../lib/effect"

const it = testEffect(LLMClient.layer.pipe(Layer.provide(RequestExecutor.fetchLayer)))
const model = { claude: "claude-opus-5-5", chatgpt: "gpt-6-luna" } as const
const variant = "high"
const marker = "x-meridian-route-refusal"
const nonce = "x-request-id"
const outgoing = Schema.decodeUnknownSync(
  Schema.Struct({
    model: Schema.String,
    reasoning: Schema.optionalKey(Schema.Struct({ effort: Schema.String })),
  }),
)

function endpoint(server: Bun.Server<undefined>) {
  return {
    claudeInferenceURL: new URL("/relay/v1/messages", server.url).href,
    chatgptAvailabilityURL: new URL("/relay/profiles/route-availability", server.url).href,
    availabilityAPIKey: "test-management-key",
  }
}

function serve(fetch: (request: Request) => Response | Promise<Response>) {
  return Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ port: 0, hostname: "127.0.0.1", fetch })),
    (server) => Effect.promise(() => server.stop(true)),
  )
}

function requestFor(server: Bun.Server<undefined>, provider: keyof typeof model) {
  const baseURL = new URL("/relay/v1", server.url).href
  if (provider === "claude")
    return ai.request({
      model: Anthropic.configure({ apiKey: "test-inference-key", baseURL }).model(model.claude),
      prompt: "do not send to management",
      providerOptions: { effort: variant },
    })
  return ai.request({
    model: OpenAI.configure({ apiKey: "test-inference-key", baseURL }).responses(model.chatgpt),
    prompt: "do not send to management",
    providerOptions: { reasoningEffort: variant },
  })
}

const cases: ReadonlyArray<{
  readonly test: string
  readonly provider: keyof typeof model
  readonly accepted?: boolean
  readonly responseMarker?: boolean
  readonly responseNonce?: string
  readonly responseVariant?: string
  readonly responseModel?: string
  readonly sent?: boolean
  readonly status?: number
  readonly mime?: string
  readonly code?: string
  readonly reason?: string
  readonly redirect?: boolean
  readonly failedFirst?: boolean
  readonly nativeHook?: boolean
}> = [
  { test: "Claude direct refusal", provider: "claude", accepted: true },
  {
    test: "Claude beta query survives the native hook round trip",
    provider: "claude",
    accepted: true,
    nativeHook: true,
  },
  { test: "ChatGPT direct refusal", provider: "chatgpt", accepted: true },
  { test: "no GPT gateway marker", provider: "chatgpt", responseMarker: false },
  { test: "wrong nonce", provider: "chatgpt", responseNonce: "other-request" },
  { test: "wrong effort", provider: "chatgpt", responseVariant: "medium" },
  { test: "wrong wire model", provider: "claude", responseModel: "another-model" },
  { test: "upstream dispatch", provider: "chatgpt", sent: true },
  { test: "authentication status", provider: "chatgpt", status: 401 },
  { test: "SSE content type", provider: "claude", mime: "text/event-stream" },
  { test: "generic rate limit", provider: "chatgpt", code: "rate_limit_exceeded" },
  { test: "policy refusal", provider: "claude", reason: "no_cvp" },
  { test: "redirect", provider: "chatgpt", redirect: true },
  { test: "clean GPT refusal after an ambiguous first send", provider: "chatgpt", failedFirst: true },
]

for (const test of cases) {
  it.live(`classifies only a direct bound pre-inference refusal: ${test.test}`, () =>
    Effect.gen(function* () {
      const wire: Array<{ id: string | null; optIn: string | null; method: string; url: string }> = []
      const server = yield* serve(async (request) => {
        const id = request.headers.get(nonce)
        const url = new URL(request.url)
        wire.push({
          id,
          optIn: request.headers.get(marker),
          method: request.method,
          url: url.pathname + url.search,
        })
        if (test.redirect && wire.length === 1)
          return new Response(null, { status: 307, headers: { location: "/followed" } })
        if (test.failedFirst && wire.length === 1)
          return Response.json({ error: { message: "unknown dispatch outcome" } }, { status: 503 })
        const body = outgoing(await request.json())
        const payload = {
          ...(test.provider === "claude" ? { type: "error" } : {}),
          error: {
            type: "rate_limit_error",
            code: test.code ?? "no_routable_account",
            request_id: test.responseNonce ?? id,
            route_refusal: {
              version: 1,
              phase: "before_inference",
              sent: test.sent ?? false,
              provider: test.provider,
              model: test.responseModel ?? body.model,
              ...(test.provider === "chatgpt" ? { variant: test.responseVariant ?? body.reasoning?.effort } : {}),
              reason: test.reason ?? "quota_exhausted",
            },
          },
        }
        return Response.json(payload, {
          status: test.status ?? 429,
          headers: {
            "content-type": test.mime ?? "application/json",
            ...(test.responseMarker === false ? {} : { [marker]: "1" }),
          },
        })
      })
      const request = requestFor(server, test.provider)
      const binding = yield* MeridianRouting.bind({
        request,
        selection: { providerID: request.model.provider, variant },
        options: test.failedFirst
          ? { http: (req, send) => send(req).pipe(Effect.flatMap(() => send(req))) }
          : test.nativeHook
            ? {
                http: (req, send) =>
                  Effect.gen(function* () {
                    const web = yield* HttpClientRequest.toWeb(req)
                    return yield* send(HttpClientRequest.setBody(HttpClientRequest.fromWeb(web), req.body))
                  }),
              }
            : undefined,
      }).pipe(Effect.provideService(MeridianRouting.Trust, endpoint(server)))
      const result = yield* LLMClient.stream(request, binding.options).pipe(Stream.runDrain, Effect.result)
      const sent = {
        id: expect.stringMatching(/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/),
        optIn: "1",
        method: "POST",
        url: test.provider === "claude" ? "/relay/v1/messages?beta=true" : "/relay/v1/responses",
      }
      expect(wire).toEqual(test.failedFirst ? [sent, sent] : [sent])
      if (test.failedFirst) expect(wire[0]?.id).not.toBe(wire[1]?.id)
      if (Result.isSuccess(result)) throw new Error("Expected provider failure")
      if (test.nativeHook) expect(result.failure.reason.http?.url).toBe(new URL("/relay/v1/messages", server.url).href)
      const requestID = wire[0]?.id
      if (!requestID) throw new Error("Expected outbound request ID")
      expect(binding.refusalOf(result.failure)).toEqual(
        test.accepted
          ? {
              requestID,
              provider: test.provider,
              wireModel: model[test.provider],
              variant,
              reason: "quota_exhausted",
            }
          : undefined,
      )
    }),
  )
}

const availabilityCases: ReadonlyArray<{
  readonly test: string
  readonly accepted?: boolean
  readonly patch?: Readonly<Record<string, string | number>>
  readonly observed?: number
  readonly status?: number
}> = [
  { test: "exact observation", accepted: true },
  { test: "wrong provider", patch: { provider: "claude" } },
  { test: "wrong model", patch: { model: "other" } },
  { test: "wrong variant", patch: { variant: "medium" } },
  { test: "no capacity", patch: { routable_allotment: 0 } },
  { test: "stale observation", observed: -30_001 },
  { test: "future observation", observed: 60_000 },
  { test: "authentication failure", status: 403 },
  { test: "redirect", status: 302 },
]

for (const test of availabilityCases) {
  it.live(`probes exact availability without prompt content: ${test.test}`, () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const hits: Array<readonly [string, string, string, string | null]> = []
      const server = yield* serve(async (request) => {
        const url = new URL(request.url)
        const params = Object.fromEntries(url.searchParams)
        hits.push([request.method, url.pathname + url.search, await request.text(), request.headers.get("x-api-key")])
        const answer = {
          version: 1,
          ...params,
          available: true,
          routable_allotment: 2,
          observed_at: now + (test.observed ?? 0),
          ...test.patch,
        }
        return Response.json(answer, { status: test.status ?? 200, headers: { location: "/must-not-follow" } })
      })
      const request = requestFor(server, "chatgpt")
      const proof = yield* MeridianRouting.probe({
        request,
        selection: { providerID: request.model.provider, variant },
      }).pipe(Effect.provideService(MeridianRouting.Trust, endpoint(server)))
      expect(proof?.validUntil).toBe(test.accepted ? now + 30_000 : undefined)
      expect(hits).toEqual([
        [
          "GET",
          "/relay/profiles/route-availability?provider=chatgpt&model=gpt-6-luna&variant=high",
          "",
          "test-management-key",
        ],
      ])
    }),
  )
}

const fenceCases: ReadonlyArray<{
  readonly test: string
  readonly dispatches: number
  readonly claims: number
  readonly repeat?: boolean
  readonly url?: string
  readonly effort?: string
  readonly injectBody?: boolean
  readonly changeAuth?: boolean
  readonly pin?: boolean
  readonly veto?: boolean
  readonly sticky?: boolean
  readonly provider?: keyof typeof model
  readonly redirect?: boolean
}> = [
  { test: "unchanged tuple sends once even when the hook tries twice", dispatches: 1, claims: 1, repeat: true },
  { test: "mismatched hook URL sends nothing", dispatches: 0, claims: 0, url: "/changed" },
  {
    test: "changed Claude beta query sends nothing",
    provider: "claude",
    url: "/relay/v1/messages?beta=false",
    dispatches: 0,
    claims: 0,
  },
  {
    test: "dropped Claude beta query sends nothing",
    provider: "claude",
    url: "/relay/v1/messages",
    dispatches: 0,
    claims: 0,
  },
  { test: "alternate redirect target receives no request", redirect: true, dispatches: 1, claims: 1 },
  { test: "mismatched hook effort sends nothing", dispatches: 0, claims: 0, effort: "medium" },
  { test: "hook injects provider session state", dispatches: 0, claims: 0, injectBody: true },
  { test: "hook changes inference credentials", dispatches: 0, claims: 0, changeAuth: true },
  { test: "hook adds an account pin", dispatches: 0, claims: 0, pin: true },
  { test: "runner veto sends nothing", dispatches: 0, claims: 1, veto: true },
  { test: "approved sticky route sends without re-probing", dispatches: 1, claims: 1, sticky: true },
]

for (const test of fenceCases) {
  it.live(`fences alternate at final wire: ${test.test}`, () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const provider = test.provider ?? "chatgpt"
      const wire: string[] = []
      let claims = 0
      const server = yield* serve((request) => {
        const url = new URL(request.url)
        wire.push(`${request.method} ${url.pathname}${request.method === "GET" ? "" : url.search}`)
        if (request.method === "GET")
          return Response.json({
            version: 1,
            provider,
            model: model[provider],
            variant,
            available: true,
            routable_allotment: 1,
            observed_at: now,
          })
        if (test.redirect && url.pathname === "/relay/v1/responses")
          return new Response(null, { status: 307, headers: { location: "/unapproved-redirect-target" } })
        return Response.json({ error: { message: "synthetic server error" } }, { status: 503 })
      })
      const request = requestFor(server, provider)
      const options: StreamOptions = {
        http: (req, send) => {
          if (test.url) return send(HttpClientRequest.setUrl(req, new URL(test.url, server.url)))
          if (test.effort)
            return send(
              HttpClientRequest.bodyJsonUnsafe(req, { model: model.chatgpt, reasoning: { effort: test.effort } }),
            )
          if (test.injectBody)
            return send(
              HttpClientRequest.bodyJsonUnsafe(req, {
                model: model.chatgpt,
                reasoning: { effort: variant },
                previous_response_id: "foreign-state",
              }),
            )
          if (test.changeAuth)
            return send(HttpClientRequest.setHeader(req, "authorization", "Bearer other-inference-key"))
          if (test.pin) return send(HttpClientRequest.setHeader(req, "x-meridian-profile", "account"))
          if (test.repeat) return send(req).pipe(Effect.flatMap(() => send(req)))
          return send(req)
        },
      }
      const dispatch = {
        allow: Effect.sync(() => {
          claims++
          return !test.veto
        }),
      }
      const input = { request, options, selection: { providerID: request.model.provider, variant } }
      const binding = yield* (
        test.sticky
          ? MeridianRouting.guard(input, dispatch)
          : MeridianRouting.probe(input).pipe(Effect.map((proof) => proof?.bindDispatch(dispatch)))
      ).pipe(Effect.provideService(MeridianRouting.Trust, endpoint(server)))
      if (!binding) throw new Error("Expected bound dispatch")
      const result = yield* LLMClient.stream(request, binding.options).pipe(Stream.runDrain, Effect.result)
      if (Result.isSuccess(result)) throw new Error("Expected provider failure or local veto")
      expect(binding.blocked(result.failure)).toBe(test.dispatches === 0)
      expect(binding.refusalOf(result.failure)).toBeUndefined()
      expect(wire).toEqual([
        ...(test.sticky ? [] : ["GET /relay/profiles/route-availability"]),
        ...(test.dispatches ? ["POST /relay/v1/responses"] : []),
      ])
      expect(claims).toBe(test.claims)
    }),
  )
}
