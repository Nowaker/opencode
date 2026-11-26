import type { HttpMiddleware } from "@opencode/ai/route"
import { NativeFetchInit } from "@opencode/util/effect/app-node-platform"
import { Effect, Option, Schema } from "effect"

export type MeridianPurpose = "chat" | "title" | "compaction" | "subagent" | "helper"

const decodeEndpoints = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))
const configured = Option.getOrUndefined(decodeEndpoints(process.env["VIBETERM_MERIDIAN_ATTRIBUTION_ENDPOINTS"]))
const endpoints = new Set(configured?.every(isEndpoint) ? configured : [])
const httpProxyVariables = ["http_proxy", "HTTP_PROXY", "all_proxy", "ALL_PROXY"] as const
// The Vibeterm machine short name the launcher sets beside the endpoints; anything else is never sent.
const device = /^[a-z0-9-]{1,63}$/.exec(process.env["VIBETERM_MERIDIAN_ATTRIBUTION_DEVICE"] ?? "")?.[0]

function isEndpoint(value: string): boolean {
  const url = URL.parse(value)
  if (!url || url.href !== value || value.includes("?") || value.includes("#") || url.username || url.password)
    return false
  // An Anthropic base without /v1 posts to a bare /messages path.
  if (!/\/(?:v1\/(?:messages|chat\/completions|responses)|messages)$/.test(url.pathname)) return false
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]" ||
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*localhost$/.test(url.hostname)))
  )
}

export function meridianAttribution(version: string | undefined, purpose: MeridianPurpose): HttpMiddleware | undefined {
  if (!endpoints.size || !version || version.length > 64 || /[^A-Za-z0-9._+-]/.test(version)) return undefined
  if (version === "unknown" || version === "local") return undefined

  return (request, send) =>
    send(request).pipe(
      Effect.provideService(NativeFetchInit, (url, init) => {
        if (init.method !== "POST" || !endpoints.has(url.href)) return init
        if (url.protocol === "http:" && !directCleartext(url, init)) return init
        const headers = new Headers(init.headers)
        const host = headers.get("host")
        if (host !== null && host.toLowerCase() !== url.host) return init
        headers.set("x-meridian-client", `opencode/${version}`)
        headers.set("x-meridian-purpose", purpose)
        headers.delete("x-meridian-session")
        headers.delete("x-meridian-device")
        if (device) headers.set("x-meridian-device", device)
        return { ...init, headers, redirect: "error" }
      }),
    )
}

function directCleartext(url: URL, init: RequestInit): boolean {
  if ("proxy" in init && init.proxy !== undefined) return false
  if (!httpProxyVariables.some((name) => process.env[name])) return true

  // Match Bun's ASCII separators; trimming Unicode whitespace can falsely trust a proxied request.
  const lower = process.env["no_proxy"]
  const bypass = lower && lower !== '""' && lower !== "''" ? lower : process.env["NO_PROXY"]
  const hostPort = `${url.hostname}:${url.port || "80"}`
  return (
    bypass
      ?.split(/[, \t\r\n]+/)
      .some(
        (entry) =>
          entry === "*" ||
          entry === url.hostname ||
          entry === hostPort ||
          (url.hostname === "[::1]" && entry === "::1"),
      ) ?? false
  )
}
