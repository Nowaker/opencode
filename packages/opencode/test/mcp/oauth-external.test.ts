import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { MCP } from "../../src/mcp"
import { McpAuth } from "../../src/mcp/auth"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { oauthMcp } from "../fixture/oauth-mcp"
import { withTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([MCP.node, McpAuth.node])))
const external = { callbackMode: "external", redirectUri: "https://portal.example/api/mcp/oauth/callback" } as const

it.instance("external start stores a real connected client when authorization is unnecessary", () =>
  Effect.gen(function* () {
    const server = yield* oauthMcp(true)
    const mcp = yield* MCP.Service
    const name = crypto.randomUUID()
    yield* mcp.add(name, { type: "remote", url: server.url, enabled: false })
    expect((yield* mcp.startAuth(name, external)).authorizationUrl).toBe("")
    expect((yield* mcp.status())[name]).toEqual({ status: "connected" })
    const client = (yield* mcp.clients())[name]
    if (!client) throw new Error("Missing connected client")
    expect((yield* Effect.promise(() => client.listTools())).tools.map((tool) => tool.name)).toEqual(["fixture"])
  }),
)

for (const oauth of [{ clientId: "static-client" }, {}]) {
  it.instance(`external callback connects with ${"clientId" in oauth ? "static" : "dynamic"} PKCE`, () =>
    Effect.gen(function* () {
      const server = yield* oauthMcp(false, "clientId" in oauth ? [external.redirectUri] : [])
      const mcp = yield* MCP.Service
      const store = yield* McpAuth.Service
      const name = crypto.randomUUID()
      yield* mcp.add(name, { type: "remote", url: server.url, enabled: false, oauth })
      const before = Date.now()
      const start = yield* mcp.startAuth(name, external)
      expect(start.callbackMode).toBe("external")
      expect(start.expiresAt).toBeGreaterThanOrEqual(before + 300_000)
      expect(new URL(start.authorizationUrl).searchParams.get("redirect_uri")).toBe(external.redirectUri)
      expect(new URL(start.authorizationUrl).searchParams.get("state")).toBe(start.oauthState)
      expect(yield* store.get(name)).toBeUndefined()
      const callback = yield* Effect.promise(() => server.authorize(start.authorizationUrl))
      yield* store.updateOAuthState(name, "unrelated-background-state")
      yield* store.updateCodeVerifier(name, "unrelated-background-verifier")
      expect((yield* mcp.finishAuth(name, callback.code, callback)).status).toBe("connected")
      expect((yield* mcp.status())[name]?.status).toBe("connected")
      expect(Object.keys(yield* mcp.tools())).toContain(`${name}_fixture`)
      expect(server.exchanges).toHaveLength(1)
      expect(server.exchanges[0]?.get("redirect_uri")).toBe(external.redirectUri)
      expect(server.registered).toEqual("clientId" in oauth ? [] : [external.redirectUri])
      expect((yield* store.get(name))?.tokens?.accessToken).toBe("synthetic-token")
      expect(yield* mcp.finishAuth(name, callback.code, callback).pipe(Effect.flip)).toMatchObject({
        _tag: "MCP.AuthFlowError",
      })
      expect(server.exchanges).toHaveLength(1)
    }),
  )
}

it.instance("external start does not bind or disturb the desktop listener", () =>
  Effect.gen(function* () {
    const server = yield* oauthMcp()
    const mcp = yield* MCP.Service
    const name = crypto.randomUUID()
    const peer = yield* Effect.acquireRelease(
      Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("old-peer") })),
      (http) => Effect.promise(() => http.stop(true)),
    )
    yield* mcp.add(name, { type: "remote", url: server.url, enabled: false, oauth: { redirectUri: peer.url.href } })
    const start = yield* mcp.startAuth(name, external)
    expect(start.callbackMode).toBe("external")
    expect(McpOAuthCallback.isRunning()).toBe(false)
    expect(yield* Effect.promise(() => fetch(peer.url).then((response) => response.text()))).toBe("old-peer")
    yield* mcp.finishAuth(name, undefined, { state: start.oauthState, error: "access_denied" })
    const manual = yield* mcp.startAuth(name)
    expect(new URL(manual.authorizationUrl).searchParams.get("redirect_uri")).toBe(peer.url.href)
    const callback = yield* Effect.promise(() => server.authorize(manual.authorizationUrl))
    expect((yield* mcp.finishAuth(name, callback.code)).status).toBe("connected")
  }),
)

it.instance("different-name external flows cannot complete each other's state", () =>
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    const entries = []
    for (const name of [crypto.randomUUID(), crypto.randomUUID()]) {
      const server = yield* oauthMcp()
      yield* mcp.add(name, { type: "remote", url: server.url, enabled: false })
      const start = yield* mcp.startAuth(name, external)
      const callback = yield* Effect.promise(() => server.authorize(start.authorizationUrl))
      entries.push({ name, server, callback })
    }
    const [first, second] = entries
    if (!first || !second) throw new Error("Missing fixtures")
    expect(yield* mcp.finishAuth(first.name, second.callback.code, second.callback).pipe(Effect.flip)).toMatchObject({
      _tag: "MCP.AuthFlowError",
    })
    for (const entry of entries) {
      expect((yield* mcp.finishAuth(entry.name, entry.callback.code, entry.callback)).status).toBe("connected")
      expect(entry.server.exchanges).toHaveLength(1)
    }
  }),
)

for (const state of [undefined, "wrong-state"]) {
  it.instance(`external callback rejects ${state ?? "missing"} state without consuming valid flow`, () =>
    Effect.gen(function* () {
      const server = yield* oauthMcp()
      const mcp = yield* MCP.Service
      const name = crypto.randomUUID()
      yield* mcp.add(name, { type: "remote", url: server.url, enabled: false })
      const start = yield* mcp.startAuth(name, external)
      expect(yield* mcp.finishAuth(name, "unused", { state }).pipe(Effect.flip)).toMatchObject({
        _tag: "MCP.AuthFlowError",
      })
      expect(server.exchanges).toHaveLength(0)
      const callback = yield* Effect.promise(() => server.authorize(start.authorizationUrl))
      expect((yield* mcp.finishAuth(name, callback.code, callback)).status).toBe("connected")
    }),
  )
}

it.instance("external denial preserves prior credentials and consumes the pending flow", () =>
  Effect.gen(function* () {
    const server = yield* oauthMcp()
    const mcp = yield* MCP.Service
    const store = yield* McpAuth.Service
    const name = crypto.randomUUID()
    yield* mcp.add(name, { type: "remote", url: server.url, enabled: false })
    yield* store.updateTokens(name, { accessToken: "prior-token" }, server.url)
    yield* store.updateClientInfo(name, { clientId: "prior-client" }, server.url)
    const start = yield* mcp.startAuth(name, external)
    expect(yield* mcp.finishAuth(name, undefined, { state: start.oauthState, error: "access_denied" })).toEqual({
      status: "failed",
      error: "OAuth authorization denied",
    })
    expect((yield* store.get(name))?.tokens?.accessToken).toBe("prior-token")
    expect((yield* store.get(name))?.clientInfo?.clientId).toBe("prior-client")
    expect(server.exchanges).toHaveLength(0)
    expect(yield* mcp.finishAuth(name, "unused", { state: start.oauthState }).pipe(Effect.flip)).toMatchObject({
      _tag: "MCP.AuthFlowError",
    })
  }),
)

it.instance("successful token exchange does not report connected when the MCP handshake fails", () =>
  Effect.gen(function* () {
    const server = yield* oauthMcp()
    const mcp = yield* MCP.Service
    const name = crypto.randomUUID()
    yield* mcp.add(name, { type: "remote", url: server.url, enabled: false })
    const start = yield* mcp.startAuth(name, external)
    const callback = yield* Effect.promise(() => server.authorize(start.authorizationUrl))
    server.failConnection()
    const result = yield* mcp.finishAuth(name, callback.code, callback)
    expect(result).toEqual({ status: "failed", error: "MCP connection failed after OAuth" })
    expect((yield* mcp.status())[name]).toEqual(result)
    expect(server.exchanges).toHaveLength(1)
  }),
)

it.instance("external flow blocks same-name external and legacy starts across directories", () =>
  Effect.gen(function* () {
    const server = yield* oauthMcp()
    const mcp = yield* MCP.Service
    const name = crypto.randomUUID()
    yield* mcp.add(name, { type: "remote", url: server.url, enabled: false })
    const start = yield* mcp.startAuth(name, external)
    for (const options of [external, undefined])
      expect(yield* mcp.startAuth(name, options).pipe(Effect.flip)).toMatchObject({ _tag: "MCP.AuthFlowError" })
    yield* Effect.gen(function* () {
      yield* mcp.add(name, { type: "remote", url: server.url, enabled: false })
      expect(yield* mcp.finishAuth(name, "unused", { state: start.oauthState }).pipe(Effect.flip)).toMatchObject({
        _tag: "MCP.AuthFlowError",
      })
      expect(yield* mcp.startAuth(name, external).pipe(Effect.flip)).toMatchObject({ _tag: "MCP.AuthFlowError" })
    }).pipe(withTmpdirInstance())
    const callback = yield* Effect.promise(() => server.authorize(start.authorizationUrl))
    const results = yield* Effect.all(
      [
        mcp.finishAuth(name, callback.code, callback).pipe(Effect.result),
        mcp.finishAuth(name, callback.code, callback).pipe(Effect.result),
      ],
      { concurrency: "unbounded" },
    )
    expect(results.filter((result) => result._tag === "Success")).toHaveLength(1)
    expect(server.exchanges).toHaveLength(1)
  }),
)
