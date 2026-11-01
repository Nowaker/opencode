import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { MCP } from "../../src/mcp"
import { McpAuth } from "../../src/mcp/auth"
import { oauthMcp } from "../fixture/oauth-mcp"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([MCP.node, McpAuth.node])))
const external = { callbackMode: "external", redirectUri: "https://portal.example/api/mcp/oauth/callback" } as const

for (const [field, value] of [
  ["redirect_uri", "https://unregistered.example/callback"],
  ["client_id", "unregistered-client"],
] as const) {
  it.instance(`synthetic authorization rejects unregistered ${field}`, () =>
    Effect.gen(function* () {
      const server = yield* oauthMcp()
      const mcp = yield* MCP.Service
      const name = crypto.randomUUID()
      yield* mcp.add(name, { type: "remote", url: server.url, enabled: false })
      const start = yield* mcp.startAuth(name, external)
      const url = new URL(start.authorizationUrl)
      url.searchParams.set(field, value)
      const response = yield* Effect.promise(() => fetch(url, { redirect: "manual" }))
      expect(response.status).toBe(400)
      expect(server.exchanges).toHaveLength(0)
    }),
  )
}

it.instance("desktop reauthentication registers its own redirect after external credentials were stored", () =>
  Effect.gen(function* () {
    const server = yield* oauthMcp()
    const mcp = yield* MCP.Service
    const auth = yield* McpAuth.Service
    const name = crypto.randomUUID()
    const peer = yield* Effect.acquireRelease(
      Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("fixture-peer") })),
      (http) => Effect.promise(() => http.stop(true)),
    )
    yield* mcp.add(name, { type: "remote", url: server.url, enabled: false, oauth: { redirectUri: peer.url.href } })
    const start = yield* mcp.startAuth(name, external)
    const callback = yield* Effect.promise(() => server.authorize(start.authorizationUrl))
    expect((yield* mcp.finishAuth(name, callback.code, callback)).status).toBe("connected")
    const externalClient = (yield* auth.get(name))?.clientInfo?.clientId
    if (!externalClient) throw new Error("External client registration was not committed")
    yield* mcp.disconnect(name)
    const desktop = yield* mcp.startAuth(name)
    const reused = new URL(desktop.authorizationUrl)
    reused.searchParams.set("client_id", externalClient)
    expect((yield* Effect.promise(() => fetch(reused, { redirect: "manual" }))).status).toBe(400)
    const code = yield* Effect.promise(() => server.authorize(desktop.authorizationUrl))
    expect(new URL(desktop.authorizationUrl).searchParams.get("redirect_uri")).toBe(peer.url.href)
    expect((yield* mcp.finishAuth(name, code.code)).status).toBe("connected")
    expect((yield* auth.get(name))?.clientInfo?.clientId).not.toBe(externalClient)
    expect(server.registered).toEqual([external.redirectUri, peer.url.href])
    expect(server.exchanges).toHaveLength(2)
  }),
)
