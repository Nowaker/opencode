import { SessionV1 } from "@opencode-ai/schema/session-v1"
import { Schema } from "effect"
import type { CybersecPreservation } from "@/session/cybersec-preservation"

export type Purpose = "chat" | "title" | "compaction" | "summary" | "subagent" | "review" | "helper" | "test"

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

type EngineAttribution = {
  readonly purpose: Purpose
  readonly sessionID?: string
  readonly version: string
}

export type RequestAttribution = EngineAttribution & { readonly client: "opencode" | SessionV1.PromptOrigin["client"] }
export type PreservationPreference = CybersecPreservation.Preference

// @ai-sdk/anthropic posts to `${baseURL}/messages`, so a base without /v1 yields a bare /messages path.
const modelPath = /\/(?:v1\/(?:messages|chat\/completions|responses)|messages)$/
const localhost = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*localhost$/
const endpoints = new Set(readEndpoints(process.env.VIBETERM_MERIDIAN_ATTRIBUTION_ENDPOINTS))
// The Vibeterm machine short name the launcher sets beside the endpoints; anything else is never sent.
const device = /^[a-z0-9-]{1,63}$/.exec(process.env.VIBETERM_MERIDIAN_ATTRIBUTION_DEVICE ?? "")?.[0]
const httpProxyVariables = ["http_proxy", "HTTP_PROXY", "all_proxy", "ALL_PROXY"] as const

function readEndpoints(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const values: unknown = JSON.parse(raw)
    if (!Array.isArray(values)) return []
    const urls: string[] = []
    for (const value of values) {
      if (typeof value !== "string" || /[?#]/.test(value)) return []
      const url = URL.parse(value)
      if (!url || url.href !== value || url.username || url.password || !modelPath.test(url.pathname)) return []
      const loopback = url.hostname === "127.0.0.1" || url.hostname === "[::1]" ||
        (url.hostname.length <= 253 && localhost.test(url.hostname))
      if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return []
      urls.push(url.href)
    }
    return urls
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return []
  }
}

const versionIsSafe = Schema.is(SessionV1.PromptOriginVersion)

export function request(input: EngineAttribution, promptOrigin?: SessionV1.PromptOrigin): RequestAttribution | undefined {
  if (endpoints.size === 0) return
  if (promptOrigin) return { ...promptOrigin, sessionID: input.sessionID }
  if (versionIsSafe(input.version)) return { ...input, client: "opencode" }
}

export function matchesBase(base: string | undefined, sdk: string) {
  if (!base || /[?#]/.test(base)) return false
  const url = URL.parse(base.replace(/\/+$/, ""))
  if (!url || url.username || url.password) return false
  // A base without a path already serializes with a trailing slash ("http://host:3450/").
  const directory = url.href.endsWith("/") ? url.href : url.href + "/"
  const has = (resource: string) => endpoints.has(new URL(resource, directory).href)
  switch (sdk) {
    case "@ai-sdk/anthropic": return has("messages")
    case "@ai-sdk/openai": return has("responses") || has("chat/completions")
    case "@ai-sdk/openai-compatible": return has("chat/completions")
    default: return false
  }
}

export function allowsInference(url: URL, init?: RequestInit): boolean {
  return endpoints.has(url.href) && (url.protocol !== "http:" || directCleartext(url, init))
}

export function wrapFetch(
  fetch: Fetch,
  attribution: RequestAttribution | undefined,
  preservation?: PreservationPreference,
): Fetch {
  return (input, init) => {
    const request = input instanceof Request ? input : undefined
    const method = init?.method ?? request?.method
    const url = URL.parse(typeof input === "string" || input instanceof URL ? input : input.url)
    if (method !== "POST" || !url || !allowsInference(url, init)) return fetch(input, init)

    const headers = new Headers(init?.headers ?? request?.headers)
    const claude = url.pathname.endsWith("/messages")
    const applyPreservation = preservation !== undefined && claude &&
      !headers.has("x-meridian-profile") && !headers.has("x-meridian-require")
    if (!attribution && !applyPreservation) return fetch(input, init)
    if (applyPreservation) {
      const header = "x-meridian-cybersec-preservation"
      if (preservation === "inherit") headers.delete(header)
      else headers.set(header, preservation)
    }
    if (attribution) {
      headers.set("x-meridian-client", `${attribution.client}/${attribution.version}`)
      headers.set("x-meridian-purpose", attribution.purpose)
      headers.delete("x-meridian-session")
      headers.delete("x-meridian-device")
      if (device) headers.set("x-meridian-device", device)
      const affinity = headers.get("x-opencode-session") ?? headers.get("x-session-affinity")
      const openAIAffinity = !claude && headers.get("x-session-id")?.trim()
      if (!affinity && !openAIAffinity && attribution.sessionID && /^[A-Za-z0-9._:-]{1,128}$/.test(attribution.sessionID)) {
        headers.set("x-meridian-session", attribution.sessionID)
      }
    }
    if (!attribution && preservation === "inherit") return fetch(input, { ...init, headers })

    // Let the existing Meridian dispatch fence inspect redirects itself.
    const redirect = (init?.redirect ?? request?.redirect) === "manual" ? "manual" : "error"
    return fetch(input, { ...init, headers, redirect })
  }
}

function directCleartext(url: URL, init: RequestInit | undefined) {
  if (init && "proxy" in init && init.proxy !== undefined) return false
  if (!httpProxyVariables.some((name) => process.env[name])) return true

  const lower = process.env.no_proxy
  const bypass = lower && lower !== '""' && lower !== "''" ? lower : process.env.NO_PROXY
  const hostPort = `${url.hostname}:${url.port || "80"}`
  // Recognize only direct, unambiguous Bun bypass tokens; Unicode whitespace is not a separator.
  return bypass?.split(/[, \t\r\n]+/).some((entry) =>
    entry === "*" || entry === url.hostname || entry === hostPort || (url.hostname === "[::1]" && entry === "::1"),
  ) ?? false
}

export * as MeridianAttribution from "./meridian-attribution"
