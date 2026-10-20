import { expect } from "bun:test"
import path from "node:path"
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { MCP } from "../../src/mcp"
import { McpAuth } from "../../src/mcp/auth"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { TestInstance } from "../fixture/fixture"
import { oauthMcp } from "../fixture/oauth-mcp"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.merge(
    LayerNode.compile(LayerNode.group([MCP.node, McpAuth.node])),
    Layer.effectDiscard(
      Effect.gen(function* () {
        yield* Effect.promise(() => resetDatabase())
        yield* Effect.addFinalizer(() => Effect.promise(() => resetDatabase()))
      }),
    ),
  ),
)
const options = { callbackMode: "external", redirectUri: "https://portal.example/api/mcp/oauth/callback" } as const

const setup = (anonymous = false) =>
  Effect.gen(function* () {
    const provider = yield* oauthMcp(anonymous)
    const instance = yield* TestInstance
    const name = crypto.randomUUID()
    yield* Effect.promise(() =>
      Bun.write(
        path.join(instance.directory, "opencode.json"),
        JSON.stringify({
          mcp: { [name]: { type: "remote", url: provider.url, enabled: false } },
        }),
      ),
    )
    const handler = HttpApiApp.webHandler()
    yield* Effect.addFinalizer(() => Effect.promise(() => handler.dispose()))
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          fetch(request) {
            return handler.handler(request, Context.make(TestInstance, instance))
          },
        }),
      ),
      (http) => Effect.promise(() => http.stop(true)),
    )
    const request = (suffix: string, body?: object) =>
      Effect.promise(() =>
        fetch(new URL(`/mcp/${name}${suffix}`, server.url), {
          method: "POST",
          headers: { "content-type": "application/json", "x-opencode-directory": instance.directory },
          body: body ? JSON.stringify(body) : undefined,
        }),
      )
    const status = () =>
      Effect.promise(() =>
        fetch(new URL("/mcp", server.url), {
          headers: { "x-opencode-directory": instance.directory },
        }).then((response) => response.json()),
      )
    const sdk = createOpencodeClient({ baseUrl: server.url.href, directory: instance.directory, fetch })
    return { provider, name, request, status, sdk }
  })

it.instance("HTTP external callback completes a real SDK OAuth and MCP connection exactly once", () =>
  Effect.gen(function* () {
    const { provider, name, request, status, sdk } = yield* setup()
    const start = yield* Effect.promise(() => sdk.mcp.auth.start({ name, ...options }))
    expect(start.response.status).toBe(200)
    const body = start.data
    if (!body) throw new Error("Missing authorization response")
    expect(body).toMatchObject({ callbackMode: "external", expiresAt: expect.any(Number) })
    const authorizationUrl = body.authorizationUrl
    const callback = yield* Effect.promise(() => provider.authorize(authorizationUrl))
    const completed = yield* Effect.promise(() => sdk.mcp.auth.callback({ name, ...callback }))
    expect(completed.response.status).toBe(200)
    expect(completed.data).toEqual({ status: "connected" })
    expect(yield* status()).toEqual({ [name]: { status: "connected" } })
    expect((yield* request("/auth/callback", callback)).status).toBe(400)
    expect(provider.exchanges).toHaveLength(1)
  }),
)

for (const redirectUri of [
  "http://public.example/callback",
  "https://user:password@portal.example/callback",
  "https://portal.example/callback#fragment",
  "not a URL",
]) {
  it.instance(`HTTP external start rejects invalid redirect ${redirectUri}`, () =>
    Effect.gen(function* () {
      const { request, provider } = yield* setup()
      const response = yield* request("/auth", { ...options, redirectUri })
      expect(response.status).toBe(400)
      expect(yield* Effect.promise(() => response.text())).not.toContain(redirectUri)
      expect(provider.registered).toEqual([])
    }),
  )
}

it.instance("HTTP callback denial and token failure return failed, not connected", () =>
  Effect.gen(function* () {
    const { request, provider } = yield* setup()
    const start = yield* request("/auth", options)
    const body: unknown = yield* Effect.promise(() => start.json())
    if (!body || typeof body !== "object" || !("oauthState" in body) || typeof body.oauthState !== "string")
      throw new Error("Missing state")
    expect((yield* request("/auth/callback", { code: "unused" })).status).toBe(400)
    expect((yield* request("/auth/callback", { code: "unused", state: "wrong" })).status).toBe(400)
    const denial = yield* request("/auth/callback", {
      state: body.oauthState,
      error: "access_denied",
      errorDescription: "untrusted-details",
    })
    expect(denial.status).toBe(200)
    expect(yield* Effect.promise(() => denial.json())).toEqual({
      status: "failed",
      error: "OAuth authorization denied",
    })
    expect(provider.exchanges).toHaveLength(0)
    const next = yield* request("/auth", options)
    const pending: unknown = yield* Effect.promise(() => next.json())
    if (!pending || typeof pending !== "object" || !("oauthState" in pending)) throw new Error("Missing state")
    const failed = yield* request("/auth/callback", { state: pending.oauthState, code: "invalid-synthetic-code" })
    expect(failed.status).toBe(200)
    expect(yield* Effect.promise(() => failed.json())).toEqual({ status: "failed", error: "OAuth completion failed" })
    expect(provider.exchanges).toHaveLength(1)
  }),
)

it.instance("HTTP schema errors do not reflect callback material", () =>
  Effect.gen(function* () {
    const { request } = yield* setup()
    const response = yield* request("/auth/callback", {
      code: { value: "synthetic-private-code" },
      state: "synthetic-private-state",
      errorDescription: "synthetic-private-description",
    })
    expect(response.status).toBe(400)
    expect(yield* Effect.promise(() => response.text())).not.toContain("synthetic-private")
  }),
)

it.instance("HTTP silent external start returns the connected discriminant consumed by Portal and bridge", () =>
  Effect.gen(function* () {
    const { sdk, name, status, provider } = yield* setup(true)
    const result = yield* Effect.promise(() => sdk.mcp.auth.start({ name, ...options }))
    expect(result.response.status).toBe(200)
    expect(result.data?.status).toBe("connected")
    expect(result.data).toMatchObject({
      authorizationUrl: "",
      callbackMode: "external",
      expiresAt: expect.any(Number),
    })
    expect(yield* status()).toEqual({ [name]: { status: "connected" } })
    expect(provider.exchanges).toHaveLength(0)
  }),
)
