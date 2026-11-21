import { Clock, Context, Effect, Option, Schema } from "effect"
import { LLMClient, type LLMRequest } from "@opencode/ai/effect"
import { type StreamOptions } from "@opencode/ai/route"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { bindHttp, hashBody, mime, wireRequest, type Binding, type Route } from "./meridian-http.js"

export type { Binding, Refusal } from "./meridian-http.js"

const AVAILABILITY_PATH = "/profiles/route-availability"
const MESSAGES_PATH = "/v1/messages"
const RESPONSES_PATH = "/v1/responses"
const MAX_AGE_MS = 30_000

export interface TrustConfig {
  readonly claudeInferenceURL?: string
  readonly chatgptAvailabilityURL?: string
  readonly availabilityAPIKey?: string
}

const startup: TrustConfig = {
  claudeInferenceURL: process.env.VIBETERM_AUTO_SWITCH_CLAUDE_INFERENCE_URL,
  chatgptAvailabilityURL: process.env.VIBETERM_AUTO_SWITCH_CHATGPT_AVAILABILITY_URL,
  availabilityAPIKey: process.env.MERIDIAN_API_KEY,
}

export const Trust = Context.Reference<TrustConfig>("@opencode/MeridianRouting/Trust", { defaultValue: () => startup })

const policyModule = process.env.VIBETERM_AUTO_SWITCH_POLICY_MODULE
const managementBases = Schema.Struct({
  claudeBaseURL: Schema.NullOr(Schema.String),
  chatgptBaseURL: Schema.NullOr(Schema.String),
})

const managedTrust = Effect.runSync(
  Effect.cached(
    Effect.gen(function* () {
      if (
        !policyModule ||
        !path.isAbsolute(policyModule) ||
        (startup.claudeInferenceURL && startup.chatgptAvailabilityURL)
      )
        return startup
      const bases = yield* Effect.tryPromise(async () => {
        const mod: { readonly readAutoSwitchMeridianTrust?: () => unknown } = await import(
          pathToFileURL(policyModule).href
        )
        return Option.getOrUndefined(
          Schema.decodeUnknownOption(managementBases)(await mod.readAutoSwitchMeridianTrust?.()),
        )
      }).pipe(Effect.orElseSucceed(() => undefined))
      return {
        ...startup,
        claudeInferenceURL: startup.claudeInferenceURL ?? mountedURL(bases?.claudeBaseURL, MESSAGES_PATH)?.href,
        chatgptAvailabilityURL:
          startup.chatgptAvailabilityURL ?? mountedURL(bases?.chatgptBaseURL, AVAILABILITY_PATH)?.href,
      }
    }),
  ),
)

export interface Selection {
  readonly providerID: string
  readonly variant: string | null
}

interface Input {
  readonly request: LLMRequest
  readonly options?: StreamOptions
  readonly selection: Selection
}

export interface Availability {
  readonly validUntil: number
  readonly bindDispatch: (input: { readonly allow: Effect.Effect<boolean> }) => Binding
}

const availabilityBody = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(1),
    provider: Schema.Literals(["claude", "chatgpt"]),
    model: Schema.String,
    variant: Schema.String,
    available: Schema.Literal(true),
    routable_allotment: Schema.Finite,
    observed_at: Schema.Int,
  }),
)

const resolveTrust = Effect.gen(function* () {
  const trust = yield* Trust
  return trust === startup ? yield* managedTrust : trust
})

export const bind = Effect.fn("MeridianRouting.bind")(function* (input: Input): Effect.fn.Return<Binding> {
  const route = selectedRoute(input, yield* resolveTrust)
  return route
    ? bindHttp(input.options, route)
    : { options: input.options, refusalOf: () => undefined, blocked: () => false }
})

export const guard = Effect.fn("MeridianRouting.guard")(function* (
  input: Input,
  dispatch: { readonly allow: Effect.Effect<boolean> },
): Effect.fn.Return<Binding | undefined> {
  const route = selectedRoute(input, yield* resolveTrust)
  if (!route) return
  const wire = yield* prepareWire(input, route)
  if (!wire) return
  return bindHttp(input.options, route, { allow: dispatch.allow, wire })
})

export const probe = Effect.fn("MeridianRouting.probe")(function* (
  input: Input,
): Effect.fn.Return<Availability | undefined> {
  const trust = yield* resolveTrust
  const route = selectedRoute(input, trust)
  if (!route) return
  const url = replaceResource(
    route.endpoint,
    route.provider === "claude" ? MESSAGES_PATH : RESPONSES_PATH,
    AVAILABILITY_PATH,
  )
  if (!url) return

  const wire = yield* prepareWire(input, route)
  if (!wire) return

  url.search = new URLSearchParams({ provider: route.provider, model: route.model, variant: route.variant }).toString()
  const proof = yield* Effect.tryPromise(async (signal) => {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "cache-control": "no-store",
        ...(trust.availabilityAPIKey ? { "x-api-key": trust.availabilityAPIKey } : {}),
      },
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
      signal,
    })
    if (
      response.status !== 200 ||
      response.url !== url.href ||
      response.redirected ||
      !mime(response.headers.get("content-type"))
    ) {
      await response.body?.cancel()
      return
    }
    return Option.getOrUndefined(Schema.decodeUnknownOption(availabilityBody)(await response.text()))
  }).pipe(
    Effect.timeout("1500 millis"),
    Effect.orElseSucceed(() => undefined),
  )
  const now = yield* Clock.currentTimeMillis
  if (
    !proof ||
    proof.provider !== route.provider ||
    proof.model !== route.model ||
    proof.variant !== route.variant ||
    proof.routable_allotment <= 0 ||
    proof.observed_at > now ||
    now - proof.observed_at > MAX_AGE_MS
  )
    return

  const validUntil = proof.observed_at + MAX_AGE_MS
  let bound = false
  return {
    validUntil,
    bindDispatch: ({ allow }) =>
      bindHttp(input.options, route, {
        allow: Effect.suspend(() => {
          if (bound) return Effect.succeed(false)
          bound = true
          return allow
        }),
        validUntil,
        wire,
      }),
  }
})

const prepareWire = Effect.fnUntraced(function* (input: Input, route: Route) {
  if (Object.keys(input.request.http?.body ?? {}).length) return
  const prepared = yield* LLMClient.prepareHttpRequest(input.request).pipe(Effect.orElseSucceed(() => undefined))
  const compiled = prepared && wireRequest(prepared, route)
  if (!compiled) return
  return { url: compiled.url, auth: compiled.auth, bodyHash: hashBody(compiled.body) }
})

function trustedURL(text: string | null | undefined) {
  if (!text || /[\\?#\s\u0000-\u001f\u007f]/u.test(text)) return
  const authority = /^https?:\/\/([^/]+)/i.exec(text)?.[1]
  if (!authority || authority.includes("@")) return
  const url = URL.parse(text)
  if (url?.protocol === "https:") return url
  if (url?.protocol === "http:" && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(authority)) return url
}

function mountedURL(base: string | null | undefined, resource: string) {
  const url = trustedURL(base)
  if (!url) return
  url.pathname = url.pathname.replace(/\/+$/, "") + resource
  return url
}

function replaceResource(url: URL | undefined, from: string, to: string) {
  if (!url?.pathname.endsWith(from)) return
  const result = new URL(url)
  result.pathname = result.pathname.slice(0, -from.length) + to
  return result
}

function selectedRoute(input: Input, trust: TrustConfig): Route | undefined {
  if (!input.selection.variant || input.options?.webSocket || input.request.fetch) return
  const model = input.request.model
  const providerID = input.selection.providerID
  const isFamily = (canonical: string) =>
    [canonical, `${canonical}-meridian`].includes(providerID) &&
    (model.provider === providerID || model.provider === canonical)
  const provider =
    model.route.protocol === "anthropic-messages" && isFamily("anthropic")
      ? "claude"
      : model.route.protocol === "openai-responses" && isFamily("openai")
        ? "chatgpt"
        : undefined
  if (!provider) return
  const endpoint =
    provider === "claude"
      ? trustedURL(trust.claudeInferenceURL)
      : replaceResource(trustedURL(trust.chatgptAvailabilityURL), AVAILABILITY_PATH, RESPONSES_PATH)
  if (!endpoint?.pathname.endsWith(provider === "claude" ? MESSAGES_PATH : RESPONSES_PATH)) return
  return { provider, model: model.id, variant: input.selection.variant, endpoint }
}

export * as MeridianRouting from "./meridian-routing.js"
