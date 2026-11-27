import { expect } from "bun:test"
import { mkdir } from "fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Effect, Layer, Schema } from "effect"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { MCP } from "../../src/mcp"
import { McpBrowser } from "../../src/mcp/browser"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { oauthMcp } from "../fixture/oauth-mcp"
import { awaitWithTimeout, testEffect } from "../lib/effect"

// Every opencode process (TUI tab, server, `opencode mcp auth`) signs in through the same redirect
// URI, so the browser's callback reaches whichever process holds that port, not necessarily the one
// whose sign-in it finishes. These tests run the other process for real.

const browser = {
  pages: [] as Array<{ status: number; detail: string }>,
  beforeCallback: undefined as (() => Promise<void>) | undefined,
}

const it = testEffect(
  LayerNode.compile(LayerNode.group([MCP.node, EventV2Bridge.node]), [
    [
      McpBrowser.node,
      Layer.succeed(
        McpBrowser.Service,
        McpBrowser.Service.of({
          open: (url) =>
            Effect.tryPromise(async () => {
              await browser.beforeCallback?.()
              const page = await fetch(url).then(
                async (response) => ({
                  status: response.status,
                  detail: (await response.text()).match(/id="oc-detail">([^<]*)</)?.[1] ?? "",
                }),
                (error: Error) => ({ status: 0, detail: error.message }),
              )
              browser.pages.push(page)
            }),
        }),
      ),
    ],
  ]),
)

const freeRedirectUri = Effect.promise(async () => {
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null) })
  const redirectUri = new URL("/mcp/oauth/callback", reservation.url).href
  await reservation.stop(true)
  return redirectUri
})

const otherProcess = (redirectUri: string, state: string) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const child = Bun.spawn(
        ["bun", path.join(import.meta.dir, "../fixture/oauth-callback-holder.ts"), redirectUri, state],
        // The test's own XDG directories, set by the preload, so both processes share one callback registry.
        { cwd: path.join(import.meta.dir, "../.."), env: { ...process.env }, stdout: "pipe", stderr: "inherit" },
      )
      const reader = child.stdout.getReader()
      const decoder = new TextDecoder()
      let buffered = ""
      const line = async () => {
        while (!buffered.includes("\n")) {
          const chunk = await reader.read()
          if (chunk.done) throw new Error(`holder exited before writing a line (exit ${await child.exited})`)
          buffered += decoder.decode(chunk.value, { stream: true })
        }
        const end = buffered.indexOf("\n")
        const value = buffered.slice(0, end)
        buffered = buffered.slice(end + 1)
        return value
      }
      expect(await line()).toBe("ready")
      return { child, line }
    }),
    ({ child }) =>
      Effect.promise(async () => {
        child.kill()
        await child.exited
      }),
  )

// Bounded below the test's own timeout, reporting what the browser was shown when it never finishes.
const finished = <A, E, R>(signIn: Effect.Effect<A, E, R>) =>
  signIn.pipe(
    Effect.timeoutOrElse({
      duration: "10 seconds",
      orElse: () =>
        Effect.fail(new Error(`the sign-in never finished; the browser saw ${JSON.stringify(browser.pages)}`)),
    }),
  )

const reset = Effect.addFinalizer(() =>
  Effect.promise(async () => {
    browser.pages = []
    browser.beforeCallback = undefined
    await McpOAuthCallback.stop()
  }),
)

it.instance(
  "a sign-in finishes while another process waits on the same callback port",
  () =>
    Effect.gen(function* () {
      yield* reset
      const server = yield* oauthMcp()
      const redirectUri = yield* freeRedirectUri
      const holder = yield* otherProcess(redirectUri, "holder-state")
      const mcp = yield* MCP.Service
      const name = crypto.randomUUID()
      yield* mcp.add(name, { type: "remote", url: server.url, enabled: false, oauth: { redirectUri } })

      const status = yield* finished(mcp.authenticate(name))

      expect(browser.pages.map((page) => page.status)).toEqual([200])
      expect(status).toEqual({ status: "connected" })
      expect(server.exchanges).toHaveLength(1)

      const unknown = yield* Effect.promise(() => fetch(`${redirectUri}?code=forged&state=nobody`))
      expect(unknown.status).toBe(400)
      expect(yield* Effect.promise(() => unknown.text())).toContain("Invalid or expired state parameter")

      const own = yield* Effect.promise(() => fetch(`${redirectUri}?code=holder-code&state=holder-state`))
      expect(own.status).toBe(200)
      expect(yield* Effect.promise(() => holder.line())).toBe("code:holder-code")
    }),
  20_000,
)

it.instance(
  "the process holding the port keeps it for others after its own sign-in ends",
  () =>
    Effect.gen(function* () {
      yield* reset
      const server = yield* oauthMcp()
      const redirectUri = yield* freeRedirectUri
      const holder = yield* otherProcess(redirectUri, "holder-state")
      const mcp = yield* MCP.Service
      const name = crypto.randomUUID()
      yield* mcp.add(name, { type: "remote", url: server.url, enabled: false, oauth: { redirectUri } })
      browser.beforeCallback = async () => {
        const own = await fetch(`${redirectUri}?code=holder-code&state=holder-state`)
        expect(own.status).toBe(200)
        expect(await holder.line()).toBe("code:holder-code")
      }

      const status = yield* finished(mcp.authenticate(name))

      expect(browser.pages.map((page) => page.status)).toEqual([200])
      expect(status).toEqual({ status: "connected" })
    }),
  20_000,
)

it.instance("authenticate leaves no callback listener when the server needs no sign-in", () =>
  Effect.gen(function* () {
    yield* reset
    const server = yield* oauthMcp(true)
    const redirectUri = yield* freeRedirectUri
    const mcp = yield* MCP.Service
    const name = crypto.randomUUID()
    yield* mcp.add(name, { type: "remote", url: server.url, enabled: false, oauth: { redirectUri } })

    expect(yield* mcp.authenticate(name)).toEqual({ status: "connected" })
    expect(McpOAuthCallback.isRunning()).toBe(false)
  }),
)

it.instance(
  "a sign-in started for pasting a code finishes when the browser returns to this machine",
  () =>
    Effect.gen(function* () {
      yield* reset
      const server = yield* oauthMcp()
      const redirectUri = yield* freeRedirectUri
      const mcp = yield* MCP.Service
      const events = yield* EventV2Bridge.Service
      const name = crypto.randomUUID()
      yield* mcp.add(name, { type: "remote", url: server.url, enabled: false, oauth: { redirectUri } })
      const connected = yield* Deferred.make<void>()
      const unsubscribe = yield* events.listen((event) => {
        if (
          event.type === MCP.ToolsChanged.type &&
          Schema.is(Schema.Struct({ server: Schema.Literal(name) }))(event.data)
        )
          Deferred.doneUnsafe(connected, Effect.void)
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsubscribe)

      const started = yield* mcp.startAuth(name)
      const page = yield* Effect.promise(() => fetch(started.authorizationUrl))

      expect(page.status).toBe(200)
      yield* awaitWithTimeout(
        Deferred.await(connected),
        "the browser callback never finished the sign-in",
        "10 seconds",
      )
      expect((yield* mcp.status())[name]).toEqual({ status: "connected" })
      expect(server.exchanges).toHaveLength(1)
      expect(McpOAuthCallback.isRunning()).toBe(false)
    }),
  20_000,
)

it.instance("pasting the code stops the sign-in's callback listener", () =>
  Effect.gen(function* () {
    yield* reset
    const server = yield* oauthMcp()
    const redirectUri = yield* freeRedirectUri
    const mcp = yield* MCP.Service
    const name = crypto.randomUUID()
    yield* mcp.add(name, { type: "remote", url: server.url, enabled: false, oauth: { redirectUri } })

    const started = yield* mcp.startAuth(name)
    expect(McpOAuthCallback.isRunning()).toBe(true)
    const callback = yield* Effect.promise(() => server.authorize(started.authorizationUrl))

    expect((yield* mcp.finishAuth(name, callback.code)).status).toBe("connected")
    expect(McpOAuthCallback.isRunning()).toBe(false)
    expect(server.exchanges).toHaveLength(1)
  }),
)

it.instance("a connect while a sign-in waits keeps that sign-in's client and verifier", () =>
  Effect.gen(function* () {
    yield* reset
    const server = yield* oauthMcp()
    const redirectUri = yield* freeRedirectUri
    const mcp = yield* MCP.Service
    const name = crypto.randomUUID()
    yield* mcp.add(name, { type: "remote", url: server.url, enabled: false, oauth: { redirectUri } })

    const started = yield* mcp.startAuth(name)
    yield* mcp.connect(name)
    expect((yield* mcp.status())[name]).toEqual({ status: "needs_auth" })
    const callback = yield* Effect.promise(() => server.authorize(started.authorizationUrl))

    expect((yield* mcp.finishAuth(name, callback.code)).status).toBe("connected")
  }),
)

it.instance(
  "a waiting process takes the port over when the process holding it exits",
  () =>
    Effect.gen(function* () {
      yield* reset
      const server = yield* oauthMcp()
      const redirectUri = yield* freeRedirectUri
      const holder = yield* otherProcess(redirectUri, "holder-state")
      const mcp = yield* MCP.Service
      const name = crypto.randomUUID()
      yield* mcp.add(name, { type: "remote", url: server.url, enabled: false, oauth: { redirectUri } })
      browser.beforeCallback = async () => {
        holder.child.kill()
        await holder.child.exited
        expect(McpOAuthCallback.isRunning()).toBe(true)
        await McpOAuthCallback.checkPort()
      }

      const status = yield* finished(mcp.authenticate(name))

      expect(browser.pages.map((page) => page.status)).toEqual([200])
      expect(status).toEqual({ status: "connected" })
      expect(McpOAuthCallback.isRunning()).toBe(false)
    }),
  20_000,
)

it.instance(
  "the port holder forwards only to a relay on this machine's loopback address",
  () =>
    Effect.gen(function* () {
      yield* reset
      const redirectUri = yield* freeRedirectUri
      yield* otherProcess(redirectUri, "holder-state")
      const hits: string[] = []
      const elsewhere = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: (request) => {
          hits.push(request.url)
          return new Response("forwarded")
        },
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => elsewhere.stop(true)))
      const callback = new URL(redirectUri)
      const registry = path.join(Global.Path.state, "mcp-oauth-callback")
      yield* Effect.promise(async () => {
        await mkdir(registry, { recursive: true })
        await Bun.write(
          path.join(registry, `${new Bun.CryptoHasher("sha256").update("planted-state").digest("hex")}.json`),
          JSON.stringify({
            relay: `http://localhost:${elsewhere.port}${callback.pathname}`,
            redirect: `${callback.port}${callback.pathname}`,
            pid: process.pid,
            expires: Date.now() + 60_000,
          }),
        )
      })

      const response = yield* Effect.promise(() => fetch(`${redirectUri}?code=stolen&state=planted-state`))

      expect(response.status).toBe(400)
      expect(hits).toEqual([])
    }),
  20_000,
)
