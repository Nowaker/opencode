import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { Effect } from "effect"

export function oauthMcp(anonymous = false, staticRedirects: readonly string[] = []) {
  return Effect.acquireRelease(
    Effect.promise(async () => {
      const sessions = new Map<string, { protocol: Server; transport: WebStandardStreamableHTTPServerTransport }>()
      const clients = new Map([["static-client", new Set(staticRedirects)]])
      const registered: string[] = []
      const exchanges: URLSearchParams[] = []
      const codes = new Map<string, { challenge: string; redirect: string; clientId: string }>()
      let connectionFailure = false
      const http = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          if (url.pathname.includes("oauth-protected-resource"))
            return Response.json({ resource: new URL("/mcp", url).href, authorization_servers: [url.origin] })
          if (url.pathname.includes("oauth-authorization-server"))
            return Response.json({
              issuer: url.origin,
              authorization_endpoint: new URL("/authorize", url).href,
              token_endpoint: new URL("/token", url).href,
              registration_endpoint: new URL("/register", url).href,
              response_types_supported: ["code"],
              token_endpoint_auth_methods_supported: ["none"],
              code_challenge_methods_supported: ["S256"],
            })
          if (url.pathname === "/register") {
            const metadata: unknown = await request.json()
            if (!metadata || typeof metadata !== "object" || !("redirect_uris" in metadata))
              return new Response(null, { status: 400 })
            const redirects = metadata.redirect_uris
            if (!Array.isArray(redirects) || !redirects.every((item): item is string => typeof item === "string"))
              return new Response(null, { status: 400 })
            registered.push(...redirects)
            const clientId = `synthetic-client-${clients.size}`
            clients.set(clientId, new Set(redirects))
            return Response.json({ ...metadata, client_id: clientId }, { status: 201 })
          }
          if (url.pathname === "/authorize") {
            const redirect = url.searchParams.get("redirect_uri")
            const challenge = url.searchParams.get("code_challenge")
            const state = url.searchParams.get("state")
            const clientId = url.searchParams.get("client_id")
            if (!redirect || !challenge || !state || !clientId || !clients.get(clientId)?.has(redirect))
              return new Response(null, { status: 400 })
            const code = crypto.randomUUID()
            codes.set(code, { redirect, challenge, clientId })
            const callback = new URL(redirect)
            callback.searchParams.set("state", state)
            callback.searchParams.set("code", code)
            return Response.redirect(callback.href, 302)
          }
          if (url.pathname === "/token") {
            const body = new URLSearchParams(await request.text())
            exchanges.push(body)
            const code = body.get("code") ?? ""
            const expected = codes.get(code)
            codes.delete(code)
            const challenge = new Bun.CryptoHasher("sha256").update(body.get("code_verifier") ?? "").digest("base64url")
            if (
              !expected ||
              expected.challenge !== challenge ||
              expected.redirect !== body.get("redirect_uri") ||
              expected.clientId !== body.get("client_id")
            )
              return Response.json({ error: "invalid_grant" }, { status: 400 })
            return Response.json({ access_token: "synthetic-token", token_type: "Bearer" })
          }
          if (url.pathname !== "/mcp") return new Response(null, { status: 404 })
          if (request.method === "GET") return new Response(null, { status: 405 })
          if (!anonymous && request.headers.get("authorization") !== "Bearer synthetic-token")
            return new Response(null, {
              status: 401,
              headers: {
                "www-authenticate": `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource"`,
              },
            })
          if (connectionFailure) return new Response("synthetic-private-details", { status: 500 })
          const session = request.headers.get("mcp-session-id")
          const existing = session ? sessions.get(session) : undefined
          if (existing) return existing.transport.handleRequest(request)
          if (session) return new Response(null, { status: 404 })
          const id = crypto.randomUUID()
          const protocol = new Server({ name: "external-oauth", version: "1" }, { capabilities: { tools: {} } })
          const transport = new WebStandardStreamableHTTPServerTransport({
            enableJsonResponse: true,
            sessionIdGenerator: () => id,
          })
          protocol.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [{ name: "fixture", inputSchema: { type: "object" } }],
          }))
          await protocol.connect(transport)
          sessions.set(id, { protocol, transport })
          return transport.handleRequest(request)
        },
      })
      return {
        url: new URL("/mcp", http.url).href,
        registered,
        exchanges,
        failConnection() {
          connectionFailure = true
        },
        async authorize(authorizationUrl: string) {
          const response = await fetch(authorizationUrl, { redirect: "manual" })
          const location = response.headers.get("location")
          if (!location) throw new Error("Synthetic authorization failed")
          const callback = new URL(location)
          const code = callback.searchParams.get("code")
          const state = callback.searchParams.get("state")
          if (!code || !state) throw new Error("Synthetic callback missing parameters")
          return { code, state }
        },
        async close() {
          await http.stop(true)
          await Promise.all([...sessions.values()].map((session) => session.protocol.close()))
        },
      }
    }),
    (server) => Effect.promise(() => server.close()),
  )
}
