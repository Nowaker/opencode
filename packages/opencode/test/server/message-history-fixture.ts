import { expect } from "bun:test"
import { Database } from "bun:sqlite"
import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { z } from "zod"
import { tmpdir } from "../fixture/fixture"

export const model = { providerID: "test", modelID: "probe" } as const

type HistoryOperation =
  | { readonly operation: "read" }
  | {
      readonly operation: "mutate"
      readonly mutation: {
        readonly action: "undo" | "redo"
        readonly expectedRevision: string
      }
    }

export type HistoryServer = {
  readonly project: string
  readonly snapshots: string
  readonly db: Database
  readonly armedID: string
  readonly createSession: () => Promise<string>
  readonly request: (route: string, init?: RequestInit) => Promise<Response>
  readonly whileShellHeld: (exercise: () => Promise<void>) => Promise<void>
  readonly history: (
    sessionID: string,
    operation: HistoryOperation,
  ) => Promise<unknown>
}

export function post(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }
}

export async function snapshotFiles(root: string) {
  const entries = await readdir(root, { recursive: true })
  return Promise.all(entries.toSorted().map(async (relative) => {
    const filename = path.join(root, relative)
    if (!(await stat(filename)).isFile()) return { relative }
    const bytes = await Bun.file(filename).arrayBuffer()
    return { relative, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") }
  }))
}

export async function withHistoryServer(
  exercise: (server: HistoryServer) => Promise<void>,
) {
  await using home = await tmpdir()
  await using project = await tmpdir({ git: true })
  const plugin = path.join(home.path, "history-probe.js")
  const probePort = path.join(home.path, "history-probe-port")
  // Expose only the actual input capability over an ephemeral loopback listener
  // inside the child. A distinct 501 proves the plugin loaded on the RED base.
  await Bun.write(plugin, `export default async (input) => {
    const shellReady = Promise.withResolvers()
    const shellRelease = Promise.withResolvers()
    const probe = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      idleTimeout: 25,
      async fetch(request) {
        const pathname = new URL(request.url).pathname
        if (pathname === "/shell-ready") {
          await shellReady.promise
          return new Response(null, { status: 204 })
        }
        if (pathname === "/shell-release" && request.method === "POST") {
          shellRelease.resolve()
          return new Response(null, { status: 204 })
        }
        const history = input.messageHistory
        if (history?.version !== 1 || typeof history.execute !== "function")
          return new Response("PluginInput.messageHistory is unavailable", { status: 501 })
        const result = await history.execute(await request.json(), (info, parts) =>
          info.role === "user" && parts.some((part) =>
            part.type === "text" && typeof part.text === "string" &&
            part.text.startsWith("Human: ") && !part.synthetic && !part.ignored))
        return Response.json(result)
      },
    })
    await Bun.write(${JSON.stringify(probePort)}, String(probe.port))
    return {
      async "shell.env"(event) {
        if (event.source !== "shell") return
        shellReady.resolve()
        await shellRelease.promise
      },
      dispose: () => {
        shellRelease.resolve()
        return probe.stop(true)
      },
    }
  }`)
  const config = path.join(home.path, "opencode.json")
  await Bun.write(config, JSON.stringify({
    model: `${model.providerID}/${model.modelID}`,
    enabled_providers: [model.providerID],
    plugin: [pathToFileURL(plugin).href],
    share: "disabled",
    snapshot: true,
    formatter: false,
    lsp: false,
    provider: {
      [model.providerID]: {
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: "http://127.0.0.1:1/v1" },
        models: {
          [model.modelID]: { name: "Probe", limit: { context: 16384, output: 1024 } },
        },
      },
    },
  }))
  const databasePath = path.join(home.path, "history.db")
  const data = path.join(home.path, "data")
  const child = Bun.spawn(
    [process.execPath, "run", "src/boot.ts", "serve", "--hostname", "127.0.0.1", "--port", "0"],
    {
      cwd: path.resolve(import.meta.dir, "../.."),
      env: {
        PATH: process.env.PATH,
        HOME: home.path,
        SHELL: "/bin/sh",
        TMPDIR: home.path,
        XDG_CONFIG_HOME: path.join(home.path, "config"),
        XDG_DATA_HOME: data,
        XDG_CACHE_HOME: path.join(home.path, "cache"),
        XDG_STATE_HOME: path.join(home.path, "state"),
        OPENCODE_TOOLS_DATA_DIR: path.join(home.path, "tools"),
        OPENCODE_PLUGINS_DATA_DIR: path.join(home.path, "plugins"),
        OPENCODE_CONFIG: config,
        OPENCODE_DB: databasePath,
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
        OPENCODE_DISABLE_MODELS_FETCH: "1",
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        OPENCODE_TEST_HOME: home.path,
        OPENCODE_TEST_MANAGED_CONFIG_DIR: path.join(home.path, "managed"),
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "inherit",
    },
  )
  const listening = Promise.withResolvers<string>()
  const reader = child.stdout.getReader()
  const stdout = (async () => {
    const decoder = new TextDecoder()
    let startup: string | undefined = ""
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      if (startup === undefined) continue
      startup = (startup + decoder.decode(chunk.value, { stream: true })).slice(-4096)
      const url = /opencode server listening on (http:\/\/127\.0\.0\.1:\d+)\r?\n/.exec(startup)?.[1]
      if (!url) continue
      startup = undefined
      listening.resolve(url)
    }
    listening.reject(new Error(`v1 server exited before listening: ${await child.exited}`))
  })().then(undefined, (error: unknown) => listening.reject(error))
  const timeout = setTimeout(
    () => listening.reject(new Error("v1 server did not publish its loopback listener")),
    20_000,
  )
  try {
    const base = await listening.promise
    clearTimeout(timeout)
    const request = (route: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      headers.set("x-opencode-directory", project.path)
      return requestLoopback(new URL(route, base), { ...init, headers })
    }
    const createSession = async () => {
      const response = await request("/session", post({ title: "History fixture" }))
      const body = await response.text()
      expect(response.status, body.slice(0, 256)).toBe(200)
      return z.object({ id: z.string() }).parse(JSON.parse(body)).id
    }

    const armedID = await createSession()
    const port = await Bun.file(probePort).text()
    const owner = new URL("http://127.0.0.1/history-probe")
    owner.port = z.string().regex(/^[1-9]\d{0,4}$/).parse(port)
    using db = new Database(databasePath)
    await exercise({
      project: project.path,
      snapshots: path.join(data, "opencode", "snapshot"),
      db,
      armedID,
      createSession,
      request,
      async whileShellHeld(exercise) {
        const sessionID = await createSession()
        const shell = request(`/session/${sessionID}/shell`, post({
          agent: "build", model, command: "printf history-shell-completed",
        }))
        try {
          const ready = await Promise.race([
            requestLoopback(new URL("/shell-ready", owner), {}),
            shell.then(({ status }) => { throw new Error(`shell finished before the gate (${status})`) }),
          ])
          expect(ready.status).toBe(204)
          await exercise()
        } finally {
          const release = new URL("/shell-release", owner)
          const [released, completed] = await Promise.all([
            requestLoopback(release, { method: "POST" }), shell,
          ])
          expect(released.status).toBe(204)
          expect(completed.status).toBe(200)
          expect(await completed.json()).toMatchObject({
            parts: [{ type: "tool", state: { status: "completed", output: "history-shell-completed" } }],
          })
        }
      },
      async history(sessionID, operation): Promise<unknown> {
        const response = await requestLoopback(owner, post({ version: 1, sessionID, ...operation }))
        const body = await response.text()
        expect(response.status, body.slice(0, 256)).toBe(200)
        return JSON.parse(body)
      },
    })
  } finally {
    clearTimeout(timeout)
    child.kill("SIGKILL")
    await child.exited
    await reader.cancel()
    await stdout
  }
}

async function requestLoopback(url: URL, init: RequestInit) {
  const controller = new AbortController()
  const label = `${init.method ?? "GET"} ${url.pathname}`
  const deadline = Promise.withResolvers<never>()
  const timer = setTimeout(() => {
    const error = new Error(`isolated v1 ${label} did not finish within 20s`)
    deadline.reject(error)
    controller.abort(error)
  }, 20_000)
  try {
    return await Promise.race([deadline.promise, (async () => {
      const response = await fetch(url, { ...init, keepalive: false, signal: controller.signal })
      const body = await response.arrayBuffer()
      return new Response(body.byteLength ? body : null, {
        status: response.status,
        headers: response.headers,
      })
    })()])
  } catch (cause) {
    if (!(cause instanceof Error)) throw cause
    throw new Error(`isolated v1 request failed: ${label}`, { cause })
  } finally {
    clearTimeout(timer)
  }
}
