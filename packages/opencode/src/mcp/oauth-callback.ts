import { createHash } from "crypto"
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http"
import path from "path"
import { Option, Schema } from "effect"
import { Global } from "@opencode-ai/core/global"
import { OauthCallbackPage } from "@opencode-ai/core/oauth/page"
import { OAUTH_CALLBACK_PORT, OAUTH_CALLBACK_PATH, parseRedirectUri } from "./oauth-provider"

/*
 * Every opencode process on a machine - each TUI, `opencode serve`, `opencode mcp auth` - registers the
 * same loopback redirect URI with the MCP authorization servers, so the browser returns every sign-in to
 * one port, held by whichever process bound it first. A sign-in's state and PKCE verifier stay in the
 * process that started it, so the holder cannot finish another process's sign-in itself. It forwards it:
 *
 * - Each waiting process listens privately on an ephemeral loopback port (its relay) and records, per
 *   sign-in, a registry file named by the SHA-256 of the state that says where that relay is.
 * - The holder settles its own states and forwards any other state it finds in the registry to the
 *   owner's relay, passing the owner's page back to the browser. Unknown states are refused as before.
 * - The holder keeps the port while any process still waits; a waiting process takes the port over when
 *   the holder goes away, so a closed tab never strands another tab's sign-in.
 *
 * Nothing listens while no sign-in waits. The registry holds no secret: the state is hashed and the
 * relay accepts only states its own process is waiting for.
 */

const OAUTH_CALLBACK_HOST = "127.0.0.1"
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
// How often a process waiting on another's port tries to take it over, and a holder whose own sign-ins
// ended checks whether any other process still waits.
const PORT_CHECK_MS = 1000
const RELAY_TIMEOUT_MS = 10_000
const REGISTRY_DIR = path.join(Global.Path.state, "mcp-oauth-callback")

// Current callback server configuration (may differ from defaults if custom redirectUri is used)
let currentPort = OAUTH_CALLBACK_PORT
let currentPath = OAUTH_CALLBACK_PATH

interface PendingAuth {
  resolve: (code: string) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

const Waiter = Schema.Struct({
  relay: Schema.String,
  redirect: Schema.String,
  pid: Schema.Int,
  expires: Schema.Finite,
})
type Waiter = typeof Waiter.Type
const decodeWaiter = Schema.decodeUnknownOption(Schema.fromJsonString(Waiter))

// The shared redirect port, while this process holds it.
let server: Server | undefined
// This process's private listener, to which the port's holder forwards this process's callbacks.
let relay: { server: Server; url: string } | undefined
let portCheck: ReturnType<typeof setInterval> | undefined
// Listener changes run one at a time, so concurrent sign-ins and port checks never bind twice.
let listenerChanges = Promise.resolve()
// Sign-ins between starting the listeners and registering their callback; the listeners stay meanwhile.
let preparing = 0
const pendingAuths = new Map<string, PendingAuth>()
// Reverse index: mcpName → oauthState, so cancelPending(mcpName) can
// find the right entry in pendingAuths (which is keyed by oauthState).
const mcpNameToState = new Map<string, string>()

function release(oauthState: string) {
  const pending = pendingAuths.get(oauthState)
  if (!pending) return undefined
  clearTimeout(pending.timeout)
  pendingAuths.delete(oauthState)
  for (const [name, state] of mcpNameToState) {
    if (state === oauthState) {
      mcpNameToState.delete(name)
      break
    }
  }
  rmSync(registryFile(oauthState), { force: true })
  return pending
}

function stopIfIdle() {
  if (pendingAuths.size > 0 || preparing > 0) return
  relay?.server.close()
  relay = undefined
  if (server && othersWaiting()) return
  server?.close()
  server = undefined
  clearInterval(portCheck)
  portCheck = undefined
}

function listener(forwarding: boolean) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://localhost:${currentPort}`)

    if (url.pathname !== currentPath) {
      res.writeHead(404)
      res.end("Not found")
      return
    }

    const state = url.searchParams.get("state")

    // Enforce state parameter presence
    if (!state) {
      const errorMsg = "Missing required state parameter - potential CSRF attack"
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
      res.end(OauthCallbackPage.error(errorMsg, { provider: "MCP" }))
      return
    }

    const waiter = forwarding && !pendingAuths.has(state) ? waiterFor(state) : undefined
    if (waiter) {
      void forward(waiter, url, state, res)
      return
    }
    settle(url, state, res)
  }
}

function settle(url: URL, state: string, res: ServerResponse) {
  const code = url.searchParams.get("code")
  const error = url.searchParams.get("error")
  const errorDescription = url.searchParams.get("error_description")

  if (error) {
    const errorMsg = errorDescription || error
    release(state)?.reject(new Error(errorMsg))
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    res.end(OauthCallbackPage.error(errorMsg, { provider: "MCP" }))
    stopIfIdle()
    return
  }

  if (!code) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
    res.end(OauthCallbackPage.error("No authorization code provided", { provider: "MCP" }))
    return
  }

  // Validate state parameter
  const pending = release(state)
  if (!pending) {
    const errorMsg = "Invalid or expired state parameter - potential CSRF attack"
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
    res.end(OauthCallbackPage.error(errorMsg, { provider: "MCP" }))
    return
  }

  pending.resolve(code)
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(OauthCallbackPage.success({ provider: "MCP" }))
  stopIfIdle()
}

// Hands a callback to the process waiting for it and shows the browser that process's page. An owner
// that went away meanwhile leaves the state unknown here, refused as any other.
async function forward(waiter: Waiter, url: URL, state: string, res: ServerResponse) {
  const target = new URL(waiter.relay)
  target.search = url.search
  const page = await fetch(target, { signal: AbortSignal.timeout(RELAY_TIMEOUT_MS) })
    .then(async (response) => ({ status: response.status, body: await response.text() }))
    .catch(() => undefined)
  if (!page) return settle(url, state, res)
  res.writeHead(page.status, { "Content-Type": "text/html; charset=utf-8" })
  res.end(page.body)
}

function registryFile(oauthState: string) {
  return path.join(REGISTRY_DIR, `${createHash("sha256").update(oauthState).digest("hex")}.json`)
}

function redirectKey() {
  return `${currentPort}${currentPath}`
}

function waiterFor(oauthState: string) {
  const waiter = readWaiter(registryFile(oauthState))
  return waiter?.redirect === redirectKey() && waiter.pid !== process.pid ? waiter : undefined
}

// Whether another live process waits on this redirect. Entries of processes that are gone or whose sign-in
// expired are removed on the way.
function othersWaiting() {
  return registryNames().some((name) => {
    const waiter = readWaiter(path.join(REGISTRY_DIR, name))
    return waiter?.redirect === redirectKey() && waiter.pid !== process.pid
  })
}

// A registry entry, kept only while its process lives and its sign-in has not expired. The relay must be
// this machine's loopback, so a stray file can never send a code elsewhere.
function readWaiter(file: string): Waiter | undefined {
  const text = readRegistry(() => readFileSync(file, "utf8"))
  if (text === undefined) return undefined
  const waiter = Option.getOrUndefined(decodeWaiter(text))
  if (
    waiter &&
    URL.parse(waiter.relay)?.hostname === OAUTH_CALLBACK_HOST &&
    waiter.expires > Date.now() &&
    processAlive(waiter.pid)
  )
    return waiter
  rmSync(file, { force: true })
  return undefined
}

function registryNames() {
  return readRegistry(() => readdirSync(REGISTRY_DIR).filter((name) => name.endsWith(".json"))) ?? []
}

// The owning process removes its entry when its sign-in settles, so an entry or the whole directory can
// vanish between listing and reading it; that only means nobody waits there.
function readRegistry<A>(read: () => A): A | undefined {
  try {
    return read()
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
}

function processAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}

function changeListeners<A>(change: () => Promise<A>): Promise<A> {
  const next = listenerChanges.then(change)
  listenerChanges = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

async function listen(handler: ReturnType<typeof listener>, port: number) {
  const candidate = createServer(handler)
  const error = await new Promise<NodeJS.ErrnoException | undefined>((resolve) => {
    candidate.once("error", resolve)
    candidate.listen(port, OAUTH_CALLBACK_HOST, () => resolve(undefined))
  })
  if (error?.code === "EADDRINUSE") return undefined
  if (error) throw error
  return candidate
}

/**
 * Takes the shared port over when its holder went away while this process waits, and lets it go once
 * neither this process nor another waits on it. Runs every PORT_CHECK_MS while either is the case;
 * exported so tests run it on demand.
 */
export function checkPort(): Promise<void> {
  return changeListeners(async () => {
    if (!server && pendingAuths.size > 0) server = await listen(listener(true), currentPort)
    stopIfIdle()
  })
}

export function ensureRunning(redirectUri?: string): Promise<void> {
  return changeListeners(async () => {
    // Parse the redirect URI to get port and path (uses defaults if not provided)
    const { port, path } = parseRedirectUri(redirectUri)

    // If listening for a different port/path, stop first
    if ((server || relay) && (currentPort !== port || currentPath !== path)) {
      await stopListeners()
    }

    currentPort = port
    currentPath = path

    if (!relay) {
      const relayServer = await listen(listener(false), 0)
      const address = relayServer?.address()
      if (!relayServer || !address || typeof address === "string")
        throw new Error("No loopback port is free for the OAuth callback relay")
      relay = { server: relayServer, url: `http://${OAUTH_CALLBACK_HOST}:${address.port}${currentPath}` }
    }
    // Held by another process: it forwards this process's callbacks, and checkPort takes over if it leaves.
    server ??= await listen(listener(true), currentPort)
    if (!portCheck) {
      portCheck = setInterval(() => void checkPort(), PORT_CHECK_MS)
      portCheck.unref()
    }
  })
}

/**
 * Starts waiting for a sign-in's callback and resolves once this process can receive it, on the shared
 * port or through whichever process holds it. Open the browser only after that.
 */
export async function listenFor(oauthState: string, mcpName: string, redirectUri?: string) {
  preparing++
  try {
    await ensureRunning(redirectUri)
    return { code: waitForCallback(oauthState, mcpName) }
  } finally {
    preparing--
  }
}

export function waitForCallback(oauthState: string, mcpName?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (relay) {
      mkdirSync(REGISTRY_DIR, { recursive: true, mode: 0o700 })
      const waiter: Waiter = {
        relay: relay.url,
        redirect: redirectKey(),
        pid: process.pid,
        expires: Date.now() + CALLBACK_TIMEOUT_MS,
      }
      writeFileSync(registryFile(oauthState), JSON.stringify(waiter), { mode: 0o600 })
    }
    if (mcpName) mcpNameToState.set(mcpName, oauthState)
    const timeout = setTimeout(() => {
      if (!release(oauthState)) return
      reject(new Error("OAuth callback timeout - authorization took too long"))
      stopIfIdle()
    }, CALLBACK_TIMEOUT_MS)
    pendingAuths.set(oauthState, { resolve, reject, timeout })
  })
}

export function cancelPending(mcpName: string): void {
  // Look up the oauthState for this mcpName via the reverse index
  const oauthState = mcpNameToState.get(mcpName)
  const pending = release(oauthState ?? mcpName)
  if (!pending) return
  mcpNameToState.delete(mcpName)
  pending.reject(new Error("Authorization cancelled"))
  stopIfIdle()
}

async function stopListeners() {
  clearInterval(portCheck)
  portCheck = undefined
  const listeners = [server, relay?.server].filter((item) => item !== undefined)
  server = undefined
  relay = undefined
  await Promise.all(listeners.map((item) => new Promise<void>((resolve) => item.close(() => resolve()))))

  for (const oauthState of pendingAuths.keys()) {
    release(oauthState)?.reject(new Error("OAuth callback server stopped"))
  }
  mcpNameToState.clear()
}

export function stop(): Promise<void> {
  return changeListeners(stopListeners)
}

/** Whether this process listens for a callback at all: on the shared port or on its own relay. */
export function isRunning(): boolean {
  return server !== undefined || relay !== undefined
}

export * as McpOAuthCallback from "./oauth-callback"
