import { expect } from "bun:test"
import { auth } from "@modelcontextprotocol/sdk/client/auth.js"
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { McpAuth } from "../../src/mcp/auth"
import { McpOAuthPendingProvider, McpOAuthProvider } from "../../src/mcp/oauth-provider"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([McpAuth.node])))
const serverUrl = "https://pkce.example/mcp"

function endpoint() {
  const challenges = new Map<string, string>()
  const requests: { code: string | null; valid: boolean }[] = []
  const fetchFn: FetchLike = async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.pathname.includes("oauth-protected-resource"))
      return Response.json({ resource: serverUrl, authorization_servers: [url.origin] })
    if (url.pathname.includes("oauth-authorization-server"))
      return Response.json({
        issuer: url.origin,
        authorization_endpoint: new URL("/authorize", url).href,
        token_endpoint: new URL("/token", url).href,
        registration_endpoint: new URL("/register", url).href,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      })
    if (url.pathname === "/register")
      return Response.json(
        { client_id: "dynamic-client", redirect_uris: ["http://127.0.0.1:19876/mcp/oauth/callback"] },
        { status: 201 },
      )
    if (url.pathname !== "/token") throw new Error(`Unexpected synthetic request: ${url}`)
    const body = new URLSearchParams(await request.text())
    const code = body.get("code")
    const challenge = code ? challenges.get(code) : undefined
    if (code) challenges.delete(code)
    const actual = new Bun.CryptoHasher("sha256").update(body.get("code_verifier") ?? "").digest("base64url")
    const valid = challenge !== undefined && challenge === actual
    requests.push({ code, valid })
    if (!valid)
      return Response.json(
        { error: "invalid_grant", error_description: challenge ? "PKCE mismatch" : "Unknown code" },
        { status: 400 },
      )
    return Response.json({ access_token: `token-${code}`, token_type: "Bearer" })
  }
  return { challenges, requests, fetchFn }
}

for (const config of [{ clientId: "static-client", clientSecret: "fixture-secret" }, {}]) {
  it.live(
    `pending PKCE survives independent providers and background writes with ${config.clientId ? "static" : "dynamic"} client`,
    () =>
      Effect.gen(function* () {
        const store = yield* McpAuth.Service
        const name = crypto.randomUUID()
        const http = endpoint()
        const providers = ["first", "second"].map(
          (code) =>
            new McpOAuthPendingProvider(
              name,
              serverUrl,
              config,
              {
                onRedirect: (url) => {
                  const challenge = url.searchParams.get("code_challenge")
                  if (!challenge) throw new Error("Missing PKCE challenge")
                  http.challenges.set(code, challenge)
                },
              },
              store,
            ),
        )
        for (const provider of providers)
          yield* Effect.promise(() => auth(provider, { serverUrl, fetchFn: http.fetchFn }))
        expect((yield* store.get(name))?.codeVerifier).toBeUndefined()
        const background = new McpOAuthProvider(name, serverUrl, {}, { onRedirect: () => {} }, store)
        yield* Effect.promise(() => background.saveCodeVerifier("background-verifier"))
        yield* store.updateTokens(name, { accessToken: "working-token" }, serverUrl)
        for (const [index, provider] of providers.entries()) {
          const code = index === 0 ? "first" : "second"
          const outcome = yield* Effect.promise(() =>
            auth(provider, { serverUrl, authorizationCode: code, fetchFn: http.fetchFn }).then(
              (result) => result,
              (error: unknown) => (error instanceof Error ? error.message : String(error)),
            ),
          )
          expect(http.requests.filter((request) => request.code === code)[0]).toEqual({ code, valid: true })
          expect(outcome).toBe("AUTHORIZED")
          expect((yield* store.get(name))?.tokens?.accessToken).toBe("working-token")
          yield* store.clearCodeVerifier(name)
        }
        expect(http.requests).toEqual([
          { code: "first", valid: true },
          { code: "second", valid: true },
        ])
        for (const provider of providers) yield* Effect.promise(() => provider.commit())
        const entry = yield* store.get(name)
        expect(entry?.tokens?.accessToken).toBe("token-second")
        expect(entry?.clientInfo?.clientId).toBe(config.clientId ? undefined : "dynamic-client")
      }),
  )
}

it.live("pending provider fails closed when only persisted verifier exists", () =>
  Effect.gen(function* () {
    const store = yield* McpAuth.Service
    const name = crypto.randomUUID()
    yield* store.updateCodeVerifier(name, "unrelated-persisted-verifier")
    const http = endpoint()
    const provider = new McpOAuthPendingProvider(
      name,
      serverUrl,
      { clientId: "static-client" },
      { onRedirect: () => {} },
      store,
    )
    yield* Effect.promise(async () => {
      await expect(
        auth(provider, {
          serverUrl,
          authorizationCode: "missing",
          fetchFn: http.fetchFn,
        }),
      ).rejects.toThrow("No code verifier saved")
    })
    expect(http.requests).toEqual([])
  }),
)

it.live("SDK retry masks a consumed PKCE mismatch as unknown code without committing credentials", () =>
  Effect.gen(function* () {
    const store = yield* McpAuth.Service
    const name = crypto.randomUUID()
    const http = endpoint()
    const provider = new McpOAuthPendingProvider(
      name,
      serverUrl,
      { clientId: "static-client" },
      {
        onRedirect: () => {
          http.challenges.set("consumed", "deliberately-wrong-challenge")
        },
      },
      store,
    )
    yield* store.updateTokens(name, { accessToken: "working-token" }, serverUrl)
    yield* store.updateClientInfo(name, { clientId: "working-client" }, serverUrl)
    yield* Effect.promise(() => auth(provider, { serverUrl, fetchFn: http.fetchFn }))
    yield* Effect.promise(async () => {
      await expect(
        auth(provider, {
          serverUrl,
          authorizationCode: "consumed",
          fetchFn: http.fetchFn,
        }),
      ).rejects.toThrow("Unknown code")
    })
    yield* Effect.promise(() => provider.commit())
    expect(http.requests).toEqual([
      { code: "consumed", valid: false },
      { code: "consumed", valid: false },
    ])
    expect((yield* store.get(name))?.tokens?.accessToken).toBe("working-token")
    expect((yield* store.get(name))?.clientInfo?.clientId).toBe("working-client")
  }),
)
