import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import { MCP } from "../../src/mcp"
import { McpBrowser } from "../../src/mcp/browser"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { oauthMcp } from "../fixture/oauth-mcp"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(MCP.node, [
    [
      McpBrowser.node,
      Layer.succeed(
        McpBrowser.Service,
        McpBrowser.Service.of({
          open: (url) =>
            Effect.tryPromise(async () => {
              const response = await fetch(url)
              await response.body?.cancel()
            }),
        }),
      ),
    ],
  ]),
)

it.instance("desktop authenticate still completes on its configured isolated callback port", () =>
  Effect.gen(function* () {
    const server = yield* oauthMcp()
    const mcp = yield* MCP.Service
    const name = crypto.randomUUID()
    const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null) })
    const redirectUri = new URL("/mcp/oauth/callback", reservation.url).href
    yield* Effect.promise(() => reservation.stop(true))
    yield* Effect.addFinalizer(() => Effect.promise(() => McpOAuthCallback.stop()))
    yield* mcp.add(name, { type: "remote", url: server.url, enabled: false, oauth: { redirectUri } })
    expect(yield* mcp.authenticate(name)).toEqual({ status: "connected" })
    expect((yield* mcp.status())[name]).toEqual({ status: "connected" })
    expect(server.registered).toEqual([redirectUri])
    expect(server.exchanges).toHaveLength(1)
  }),
)
