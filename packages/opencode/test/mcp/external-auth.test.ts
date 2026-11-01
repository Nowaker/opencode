import { expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { AuthStartOptions, ExternalAuth } from "../../src/mcp/external-auth"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

it.live("expired external state is rejected without allowing a late claim", () =>
  Effect.gen(function* () {
    let now = 1000
    const registry = new ExternalAuth(() => now)
    const flow = yield* registry.reserve("fixture", "owner", "https://portal.example/callback")
    let closed = false
    flow.transport = new StreamableHTTPClientTransport(new URL("https://synthetic.example/mcp"))
    flow.transport.onclose = () => {
      closed = true
    }
    flow.phase = "pending"
    now = flow.expiresAt
    expect(yield* registry.claim("fixture", "owner", flow.oauthState).pipe(Effect.flip)).toMatchObject({
      _tag: "MCP.AuthFlowError",
    })
    expect(registry.active("fixture")).toBe(false)
    expect(registry.owns("fixture", flow)).toBe(false)
    expect(closed).toBe(true)
    expect(flow.abort.signal.aborted).toBe(true)
  }),
)

it.live("directory disposal releases abandoned external flows", () =>
  Effect.gen(function* () {
    const registry = new ExternalAuth()
    const flow = yield* registry.reserve("fixture", "owner", "https://portal.example/callback")
    yield* Effect.promise(() => registry.releaseDirectory("owner"))
    expect(yield* registry.claim("fixture", "owner", flow.oauthState).pipe(Effect.flip)).toMatchObject({
      _tag: "MCP.AuthFlowError",
    })
    const replacement = yield* registry.reserve("fixture", "owner", "https://portal.example/callback")
    expect(registry.owns("fixture", flow)).toBe(false)
    expect(registry.owns("fixture", replacement)).toBe(true)
    yield* Effect.promise(() => registry.releaseDirectory("owner"))
  }),
)

for (const redirectUri of [
  "https://portal.example/callback?source=portal",
  "http://localhost:1234/callback",
  "http://127.0.0.2:1234/callback",
  "http://[::1]:1234/callback",
]) {
  it.live(`permits secure or loopback callback ${redirectUri}`, () =>
    Effect.sync(() => {
      expect(Schema.is(AuthStartOptions)({ callbackMode: "external", redirectUri })).toBe(true)
    }),
  )
}
