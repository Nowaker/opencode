import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { Deferred, Effect } from "effect"
import { InstanceRef } from "../../src/effect/instance-ref"
import { registerDisposer } from "../../src/effect/instance-registry"
import { InstanceActivity } from "../../src/project/instance-activity"
import { waitFor } from "../../script/serve-idle-probe"

export function gate() {
  return {
    started: Promise.withResolvers<void>(),
    finish: Promise.withResolvers<void>(),
    settled: Promise.withResolvers<void>(),
  }
}

export type Gate = ReturnType<typeof gate>

async function hold(gate: Gate) {
  gate.started.resolve()
  await gate.finish.promise
  gate.settled.resolve()
}

export const server = Effect.acquireRelease(
  Effect.promise(async () => {
    const protocol = new Server({ name: "native-lifetime", version: "1.0.0" }, { capabilities: { tools: {} } })
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true,
    })
    const slow = gate()
    const token = gate()
    const connect = gate()
    const state = { oauth: false, holdToken: false, holdConnect: false }
    protocol.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: ["slow", "fast"].map((name) => ({
        name,
        inputSchema: { type: "object" as const },
      })),
    }))
    protocol.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === "slow") await hold(slow)
      if (request.params.name === "fast") await slow.started.promise
      return { content: [{ type: "text", text: request.params.name }] }
    })
    await protocol.connect(transport)
    const http = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname.startsWith("/.well-known/oauth-protected-resource"))
          return Response.json({
            resource: new URL("/mcp", url).href,
            authorization_servers: [url.origin],
            scopes_supported: ["mcp"],
          })
        if (url.pathname === "/.well-known/oauth-authorization-server")
          return Response.json({
            issuer: url.origin,
            authorization_endpoint: new URL("/authorize", url).href,
            token_endpoint: new URL("/token", url).href,
            registration_endpoint: new URL("/register", url).href,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code"],
            token_endpoint_auth_methods_supported: ["none"],
            code_challenge_methods_supported: ["S256"],
          })
        if (url.pathname === "/register")
          return Response.json(
            {
              ...(await request.json()),
              client_id: "lifetime-fixture-client",
            },
            { status: 201 },
          )
        if (url.pathname === "/token") {
          if (state.holdToken) await hold(token)
          return Response.json({ access_token: "lifetime-fixture-token", token_type: "Bearer" })
        }
        if (url.pathname !== "/mcp") return new Response(null, { status: 404 })
        if (request.method === "GET") return new Response(null, { status: 405 })
        if (state.oauth && !request.headers.has("authorization"))
          return new Response(null, {
            status: 401,
            headers: {
              "WWW-Authenticate": `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource", url).href}"`,
            },
          })
        if (state.holdConnect) await hold(connect)
        return transport.handleRequest(request)
      },
    })
    return {
      url: new URL("/mcp", http.url).href,
      state,
      slow,
      token,
      connect,
      close: async () => {
        for (const gate of [slow, token, connect]) gate.finish.resolve()
        await http.stop(true)
        await protocol.close()
      },
    }
  }),
  (server) => Effect.promise(server.close),
)

export const observe = Effect.gen(function* () {
  const ctx = yield* InstanceRef
  if (!ctx) return yield* Effect.die(new Error("missing test instance"))
  const disposed = yield* Deferred.make<void>()
  const calls: string[] = []
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      registerDisposer(async (directory) => {
        if (directory !== ctx.directory) return
        calls.push(directory)
        Deferred.doneUnsafe(disposed, Effect.void)
      }),
    ),
    (off) => Effect.sync(off),
  )
  const settled = Effect.promise(() =>
    waitFor(
      async () => (InstanceActivity.get(ctx)?.active === 0 ? true : undefined),
      "native instance activity did not settle",
    ),
  )
  return { calls, disposed, settled }
})
