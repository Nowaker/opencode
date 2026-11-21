import { APICallError } from "ai"
import { Clock, Context, Effect, Option, Schema } from "effect"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { Provider } from "./provider"
import { MeridianRefusal } from "./meridian-refusal"

export type TrustConfig = {
  readonly claudeInferenceURL?: string
  readonly chatgptAvailabilityURL?: string
  readonly availabilityAPIKey?: string
}

const startup: TrustConfig = {
  claudeInferenceURL: process.env.VIBETERM_AUTO_SWITCH_CLAUDE_INFERENCE_URL,
  chatgptAvailabilityURL: process.env.VIBETERM_AUTO_SWITCH_CHATGPT_AVAILABILITY_URL,
  availabilityAPIKey: process.env.MERIDIAN_API_KEY,
}

export const Trust = Context.Reference<TrustConfig>("~opencode/MeridianRouting/Trust", { defaultValue: () => startup })

const policyModule = process.env.VIBETERM_AUTO_SWITCH_POLICY_MODULE
const managementBases = Schema.Struct({
  claudeBaseURL: Schema.NullOr(Schema.String),
  chatgptBaseURL: Schema.NullOr(Schema.String),
})
const AVAILABILITY_PATH = "/profiles/route-availability"
const CLAUDE_INFERENCE_PATH = "/v1/messages"
const CHATGPT_INFERENCE_PATH = "/v1/responses"
const AVAILABILITY_MAX_AGE_MS = 30_000
const AVAILABILITY_TIMEOUT_MS = 1_500

const managedTrust = Effect.runSync(Effect.cached(Effect.gen(function* () {
  if (!policyModule || !path.isAbsolute(policyModule)) return startup
  if (startup.claudeInferenceURL !== undefined && startup.chatgptAvailabilityURL !== undefined) return startup
  const bases = yield* Effect.tryPromise(async () => {
    const mod: { readonly readAutoSwitchMeridianTrust?: () => unknown } = await import(pathToFileURL(policyModule).href)
    return Option.getOrUndefined(Schema.decodeUnknownOption(managementBases)(await mod.readAutoSwitchMeridianTrust?.()))
  }).pipe(Effect.orElseSucceed(() => undefined))
  if (!bases) return startup
  return {
    ...startup,
    claudeInferenceURL: startup.claudeInferenceURL ?? mountedURL(bases.claudeBaseURL, CLAUDE_INFERENCE_PATH),
    chatgptAvailabilityURL: startup.chatgptAvailabilityURL ?? mountedURL(bases.chatgptBaseURL, AVAILABILITY_PATH),
  }
})))

export const resolvedTrust = Effect.fnUntraced(function* () {
  const trust = yield* Trust
  return trust === startup ? yield* managedTrust : trust
})

export type Refusal = MeridianRefusal.Proof
export const refusalOf = MeridianRefusal.proofOf

export class DispatchBlocked extends Error {
  override readonly name = "MeridianDispatchBlocked"
  constructor() {
    super("Meridian request did not pass the dispatch fence")
  }
}

type Model = Pick<Provider.Model, "api" | "providerID">
type Target = { readonly model: Model; readonly variant: string }
type RouteProvider = "claude" | "chatgpt"

const availabilityBody = Schema.fromJsonString(Schema.Struct({
  version: Schema.Literal(1),
  provider: Schema.Literals(["claude", "chatgpt"]),
  model: Schema.String,
  variant: Schema.String,
  available: Schema.Literal(true),
  routable_allotment: Schema.Finite,
  observed_at: Schema.Int,
}))

export const probe = Effect.fn("MeridianRouting.probe")(function* (input: Target & { readonly provider?: RouteProvider }) {
  const trust = yield* resolvedTrust()
  const provider = input.provider ?? "chatgpt"
  const url = availabilityURL(trust)
  if (!url || !matchesProvider(provider, input.model) || !input.variant) return undefined
  const model = input.model.api.id
  url.search = new URLSearchParams({ provider, model, variant: input.variant }).toString()

  const result = yield* Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, {
        method: "GET",
        headers: trust.availabilityAPIKey ? { "x-api-key": trust.availabilityAPIKey } : undefined,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(AVAILABILITY_TIMEOUT_MS)]),
      })
      if (!isJSONResponse(response, url, 200)) {
        await response.body?.cancel()
        return undefined
      }
      return Option.getOrUndefined(Schema.decodeUnknownOption(availabilityBody)(await response.text()))
    },
    catch: (error) => error,
  }).pipe(Effect.orElseSucceed(() => undefined))
  const now = yield* Clock.currentTimeMillis
  if (!result || result.provider !== provider || result.model !== model || result.variant !== input.variant) return undefined
  const validUntil = result.observed_at + AVAILABILITY_MAX_AGE_MS
  if (result.routable_allotment <= 0 || result.observed_at > now || validUntil < now) return undefined
  return validUntil
})

export const probePreferred = Effect.fnUntraced(function* (input: {
  readonly providerID: string
  readonly modelID: string
  readonly variant: string | null
}) {
  const provider = routeProvider(input.providerID)
  if (!provider || !input.variant) return
  const trust = yield* resolvedTrust()
  const model = {
    providerID: ProviderV2.ID.make(input.providerID),
    api: { id: input.modelID, npm: provider === "claude" ? "@ai-sdk/anthropic" : "@ai-sdk/openai", url: "" },
  }
  if (!transportFor(trust, model)) return
  return yield* probe({ provider, model, variant: input.variant }).pipe(Effect.provideService(Trust, trust))
})

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
type Fence = {
  readonly variant: string
  readonly singleDispatch: boolean
  readonly dispatch: (send: () => Promise<Response>) => Promise<Response>
}

export type Transport = { readonly endpoint: URL; readonly wireModel: string } & (
  | { readonly type: "claude"; readonly fence?: Fence }
  | { readonly type: "chatgpt"; readonly fence?: Fence }
)

export function transportFor(trust: TrustConfig, model: Model, fence?: Fence) {
  return routeProvider(model.providerID) === "claude" ? claudeTransport(trust, model, fence) : chatgptTransport(trust, model, fence)
}

export function claudeTransport(trust: TrustConfig, model: Model, fence?: Fence): Transport | undefined {
  if (!matchesProvider("claude", model)) return undefined
  const endpoint = trustedURL(trust.claudeInferenceURL)
  if (!endpoint || (fence && (!fence.variant || !endpoint.pathname.endsWith(CLAUDE_INFERENCE_PATH)))) return undefined
  return { type: "claude", endpoint, wireModel: model.api.id, fence }
}

export function chatgptTransport(trust: TrustConfig, model: Model, fence?: Fence): Transport | undefined {
  const endpoint = availabilityURL(trust)
  if (!endpoint || !matchesProvider("chatgpt", model) || (fence && !fence.variant)) return undefined
  endpoint.pathname = endpoint.pathname.slice(0, -AVAILABILITY_PATH.length) + CHATGPT_INFERENCE_PATH
  return { type: "chatgpt", endpoint, wireModel: model.api.id, fence }
}

const requestBody = Schema.fromJsonString(Schema.Struct({
  model: Schema.String,
  reasoning: Schema.optionalKey(Schema.Struct({ effort: Schema.optionalKey(Schema.String) })),
  output_config: Schema.optionalKey(Schema.Struct({ effort: Schema.optionalKey(Schema.String) })),
}))

export function wrapFetch(fetch: Fetch, transport: Transport): Fetch {
  let requests = 0
  return async (input, init) => {
    const url = URL.parse(typeof input === "string" || input instanceof URL ? input : input.url)
    const matches = url?.href === transport.endpoint.href && init?.method === "POST"
    const body = typeof init?.body === "string"
      ? Option.getOrUndefined(Schema.decodeUnknownOption(requestBody)(init.body))
      : undefined
    const fence = transport.fence
    const effort = transport.type === "claude" ? body?.output_config?.effort : body?.reasoning?.effort
    const headers = new Headers(init?.headers)
    const pinned = headers.has("x-meridian-profile")
    if (fence && (pinned || !matches || body?.model !== transport.wireModel || effort !== fence.variant))
      throw new DispatchBlocked()

    const send = async () => {
      if (fence?.singleDispatch && requests > 0) throw new DispatchBlocked()
      init?.signal?.throwIfAborted()
      requests++
      if (!matches) return fetch(input, init)
      const requestID = !pinned && (transport.type === "claude" || (effort && body?.model === transport.wireModel))
        ? crypto.randomUUID()
        : undefined
      if (requestID) {
        headers.set("x-request-id", requestID)
        headers.set(MeridianRefusal.header, "1")
      }
      const response = await fetch(input, { ...init, headers, redirect: "manual" })
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel()
        throw new APICallError({
          message: "Meridian inference endpoint returned a redirect",
          url: transport.endpoint.href,
          requestBodyValues: undefined,
          statusCode: response.status,
          isRetryable: false,
        })
      }
      if (!requestID || requests !== 1 || body?.model !== transport.wireModel || !isJSONResponse(response, transport.endpoint, 429)) {
        return response
      }

      const request = { requestID, wireModel: transport.wireModel }
      const error = transport.type === "claude"
        ? await MeridianRefusal.attest(response, { ...request, type: "claude", variant: effort })
        : effort && await MeridianRefusal.attest(response, { ...request, type: "chatgpt", variant: effort })
      if (!error) return response
      await response.body?.cancel()
      throw error
    }
    return fence ? fence.dispatch(send) : send()
  }
}

export function routeProvider(providerID: string): RouteProvider | undefined {
  if (providerID === "anthropic" || providerID === "anthropic-meridian") return "claude"
  if (providerID === "openai" || providerID === "openai-meridian") return "chatgpt"
}

function matchesProvider(provider: RouteProvider, model: Model) {
  return routeProvider(model.providerID) === provider && model.api.npm === (provider === "claude" ? "@ai-sdk/anthropic" : "@ai-sdk/openai")
}

function trustedURL(value: string | null | undefined) {
  const url = value ? URL.parse(value) : null
  if (!url || url.username || url.password || url.hash || url.search) return undefined
  if (url.protocol === "https:") return url
  if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return url
}

function mountedURL(base: string | null, resource: string) {
  const url = trustedURL(base)
  if (!url) return undefined
  url.pathname = url.pathname.replace(/\/+$/, "") + resource
  return url.href
}

function availabilityURL(trust: TrustConfig) {
  const url = trustedURL(trust.chatgptAvailabilityURL)
  return url?.pathname.endsWith(AVAILABILITY_PATH) ? url : undefined
}

function isJSONResponse(response: Response, endpoint: URL, status: number) {
  const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  return response.status === status && !response.redirected && response.url === endpoint.href && mime === "application/json"
}

export * as MeridianRouting from "./meridian-routing"
