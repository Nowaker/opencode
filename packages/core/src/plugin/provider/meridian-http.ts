import { type AIError } from "@opencode/ai/effect"
import { type HttpMiddleware, type StreamOptions } from "@opencode/ai/route"
import { Clock, Effect, Option, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { createHash } from "node:crypto"

export type RouteProvider = "claude" | "chatgpt"
export interface Route {
  readonly provider: RouteProvider
  readonly model: string
  readonly variant: string
  readonly endpoint: URL
}

const refusalFields = {
  version: Schema.Literal(1),
  phase: Schema.Literal("before_inference"),
  sent: Schema.Literal(false),
  model: Schema.String,
  reason: Schema.Literals(["quota_exhausted", "reserve_held"]),
}
const refusalError = {
  type: Schema.Literal("rate_limit_error"),
  code: Schema.Literal("no_routable_account"),
  request_id: Schema.String,
}
const claudeRefusal = Schema.fromJsonString(
  Schema.Struct({
    type: Schema.Literal("error"),
    error: Schema.Struct({
      ...refusalError,
      route_refusal: Schema.Struct({ ...refusalFields, provider: Schema.Literal("claude") }),
    }),
  }),
)
const chatgptRefusal = Schema.fromJsonString(
  Schema.Struct({
    error: Schema.Struct({
      ...refusalError,
      route_refusal: Schema.Struct({ ...refusalFields, provider: Schema.Literal("chatgpt"), variant: Schema.String }),
    }),
  }),
)

export interface Refusal {
  readonly requestID: string
  readonly provider: RouteProvider
  readonly wireModel: string
  readonly variant: string
  readonly reason: typeof refusalFields.reason.Type
}

export interface Binding {
  readonly options: StreamOptions | undefined
  readonly refusalOf: (error: AIError) => Refusal | undefined
  readonly blocked: (error: AIError) => boolean
}

const decodeWire = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      model: Schema.String,
      reasoning: Schema.optionalKey(Schema.Struct({ effort: Schema.optionalKey(Schema.String) })),
      output_config: Schema.optionalKey(Schema.Struct({ effort: Schema.optionalKey(Schema.String) })),
    }),
  ),
)

const routingHeaders = ["authorization", "x-api-key", "anthropic-api-key", "anthropic-beta", "cookie"] as const

export function wireRequest(request: HttpClientRequest.HttpClientRequest, route: Route) {
  if (
    request.method !== "POST" ||
    request.headers["content-encoding"] ||
    !mime(request.headers["content-type"]) ||
    ["x-meridian-profile", "x-meridian-require", "x-meridian-internal-hop", "chatgpt-account-id", "host"].some(
      (key) => key in request.headers,
    )
  )
    return
  const url = Option.getOrUndefined(HttpClientRequest.toUrl(request))
  if (!url) return
  const betaURL = new URL(route.endpoint)
  if (route.provider === "claude") betaURL.searchParams.set("beta", "true")
  if (url.href !== route.endpoint.href && url.href !== betaURL.href) return
  const body =
    request.body._tag === "Raw" && typeof request.body.body === "string"
      ? request.body.body
      : request.body._tag === "Uint8Array"
        ? new TextDecoder().decode(request.body.body)
        : undefined
  if (!body) return
  const decoded = Option.getOrUndefined(decodeWire(body))
  const variant = route.provider === "claude" ? decoded?.output_config?.effort : decoded?.reasoning?.effort
  if (decoded?.model !== route.model || variant !== route.variant) return
  return { url: url.href, auth: routingHeaders.map((key) => request.headers[key]), body }
}

export const hashBody = (body: string) => createHash("sha256").update(body).digest("hex")

export function mime(contentType: string | null | undefined) {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
}

class DispatchBlocked extends Error {
  override readonly name = "MeridianDispatchBlocked"
  constructor() {
    super("Meridian request did not pass the dispatch fence")
  }
}

class MeridianRedirect extends Error {
  constructor() {
    super("Meridian inference endpoint returned a redirect")
  }
}

interface DispatchFence {
  readonly allow: Effect.Effect<boolean>
  readonly validUntil?: number
  readonly wire: { readonly url: string; readonly auth: readonly (string | undefined)[]; readonly bodyHash: string }
}

export function bindHttp(options: StreamOptions | undefined, route: Route, fence?: DispatchFence): Binding {
  const veto = new DispatchBlocked()
  let sends = 0
  let attempted = false
  let evidence: (NonNullable<Awaited<ReturnType<typeof readRefusal>>> & { readonly diagnosticURL: string }) | undefined
  const http: HttpMiddleware = (original, next) => {
    if (!fence && options?.http && !wireRequest(original, route)) return options.http(original, next)
    const send = (request: HttpClientRequest.HttpClientRequest) =>
      Effect.gen(function* () {
        const wire = wireRequest(request, route)
        sends++
        if (
          fence &&
          (sends !== 1 ||
            !wire ||
            wire.url !== fence.wire.url ||
            wire.auth.some((value, index) => value !== fence.wire.auth[index]) ||
            hashBody(wire.body) !== fence.wire.bodyHash ||
            (fence.validUntil !== undefined && (yield* Clock.currentTimeMillis) > fence.validUntil) ||
            !(yield* fence.allow) ||
            (fence.validUntil !== undefined && (yield* Clock.currentTimeMillis) > fence.validUntil))
        )
          return yield* Effect.fail(veto)
        if (!wire) return yield* next(request)

        const requestID = crypto.randomUUID()
        const outbound = HttpClientRequest.setHeaders(
          fence ? HttpClientRequest.bodyText(request, wire.body, request.headers["content-type"]) : request,
          {
            "x-request-id": requestID,
            "x-meridian-route-refusal": "1",
          },
        )
        const observe = async (...[url, init]: Parameters<typeof fetch>) => {
          init?.signal?.throwIfAborted()
          attempted = true
          const response = await fetch(url, { ...init, redirect: "manual", credentials: "omit" })
          if (response.status >= 300 && response.status < 400) {
            await response.body?.cancel()
            throw new MeridianRedirect()
          }
          if (sends === 1 && response.url === wire.url) {
            const proof = await readRefusal(response, route, requestID)
            // AIError reports request.url, while Fetch sends the URL with separately stored query parameters.
            if (proof) evidence = { ...proof, diagnosticURL: request.url }
          }
          return response
        }
        return yield* HttpClient.execute(outbound).pipe(
          Effect.provideService(FetchHttpClient.Fetch, Object.assign(observe, { preconnect: fetch.preconnect })),
          Effect.provideService(FetchHttpClient.RequestInit, {}),
          Effect.provide(FetchHttpClient.layer),
        )
      })
    return options?.http ? options.http(original, send) : send(original)
  }
  return {
    options: { ...options, http },
    refusalOf: (error) =>
      evidence &&
      sends === 1 &&
      error.status === 429 &&
      error.reason.http?.url === evidence.diagnosticURL &&
      error.reason.body === evidence.body &&
      !error.partial
        ? evidence.refusal
        : undefined,
    blocked: (error) => !attempted && error.reason.cause === veto,
  }
}

async function readRefusal(response: Response, route: Route, requestID: string) {
  if (
    response.redirected ||
    response.status !== 429 ||
    !mime(response.headers.get("content-type")) ||
    (route.provider === "chatgpt" && response.headers.get("x-meridian-route-refusal") !== "1")
  )
    return
  const body = await response
    .clone()
    .text()
    .catch(() => undefined)
  if (body === undefined) return
  const decoded =
    route.provider === "claude"
      ? Option.getOrUndefined(Schema.decodeUnknownOption(claudeRefusal)(body))?.error
      : Option.getOrUndefined(Schema.decodeUnknownOption(chatgptRefusal)(body))?.error
  const proof = decoded?.route_refusal
  if (
    decoded?.request_id !== requestID ||
    proof?.model !== route.model ||
    (proof.provider === "chatgpt" && proof.variant !== route.variant)
  )
    return
  const refusal: Refusal = {
    requestID,
    provider: proof.provider,
    wireModel: proof.model,
    variant: route.variant,
    reason: proof.reason,
  }
  return { body, refusal }
}
