import { expect, test } from "bun:test"
import { createServer } from "node:http"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { createOpencodeClient } from "../../../sdk/js/src/v2/client"

async function poll<A>(read: () => Promise<A | undefined>, message: string) {
  const deadline = Date.now() + 20_000
  while (true) {
    const value = await read()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(message)
    await Bun.sleep(10)
  }
}

test("isolated HTTP abort records its requester and disposal persists per-run provenance across subsequent turns", async () => {
  await using tmp = await tmpdir()
  const provider = createServer((request, response) => {
    request.resume()
    request.on("end", () => {
      response.writeHead(200, { "Content-Type": "text/event-stream" })
      response.write(`data: ${JSON.stringify({
        id: "abort-probe",
        object: "chat.completion.chunk",
        choices: [{ delta: { role: "assistant", content: "probe" } }],
      })}\n\n`)
    })
  })
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve))
  const address = provider.address()
  if (!address || typeof address === "string") throw new Error("provider listener has no TCP address")
  const config = path.join(tmp.path, "probe-config.json")
  await Bun.write(
    config,
    JSON.stringify({
      model: "test/probe",
      snapshot: false,
      formatter: false,
      lsp: false,
      share: "disabled",
      provider: {
        test: {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: "test-key" },
          models: { probe: { name: "Probe", limit: { context: 16384, output: 1024 } } },
        },
      },
    }),
  )
  const child = Bun.spawn([process.execPath, "run", "src/boot.ts", "serve", "--hostname", "127.0.0.1", "--port", "0"], {
    cwd: path.resolve(import.meta.dir, "../.."),
    env: {
      PATH: process.env.PATH,
      HOME: tmp.path,
      SHELL: "/bin/sh",
      XDG_CONFIG_HOME: path.join(tmp.path, "config"),
      XDG_DATA_HOME: path.join(tmp.path, "data"),
      XDG_CACHE_HOME: path.join(tmp.path, "cache"),
      XDG_STATE_HOME: path.join(tmp.path, "state"),
      OPENCODE_TOOLS_DATA_DIR: path.join(tmp.path, "tools"),
      OPENCODE_PLUGINS_DATA_DIR: path.join(tmp.path, "plugins"),
      OPENCODE_CONFIG: config,
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_DISABLE_MODELS_FETCH: "1",
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
      OPENCODE_TEST_HOME: tmp.path,
      OPENCODE_TEST_MANAGED_CONFIG_DIR: path.join(tmp.path, "managed"),
      OPENCODE_EXPERIMENTAL_EVENT_SYSTEM: "true",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const errors = new Response(child.stderr).text()
  try {
    const reader = child.stdout.getReader()
    const decoder = new TextDecoder()
    const baseURL = await Promise.race([
      (async () => {
        let output = ""
        while (true) {
          const next = await reader.read()
          if (next.done) throw new Error(`isolated engine exited before listening: ${child.exitCode}`)
          output += decoder.decode(next.value)
          const match = output.match(/opencode server listening on (http:\/\/127\.0\.0\.1:\d+)/)
          if (match?.[1]) return match[1]
        }
      })(),
      Bun.sleep(20_000).then(() => {
        throw new Error("isolated engine never published its listener")
      }),
    ])
    const client = createOpencodeClient({ baseUrl: baseURL, directory: tmp.path })
    expect((await client.global.health({ throwOnError: true })).data.healthy).toBe(true)
    const created = await client.session.create({ title: "Abort provenance" }, { throwOnError: true })
    const sessionID = created.data.id
    const seen = new Set<string>()
    // "abort" is a bare HTTP abort; "tui" and "tui-revert" pass their requester. Each disposal follows a
    // requester-carrying cancel, so a requester leaking into the next run would show up on its row.
    for (const action of ["abort", "tui", "instance", "tui-revert", "global", "config", "abort"] as const) {
      await client.session.promptAsync({ sessionID, parts: [{ type: "text", text: action }] }, { throwOnError: true })
      const assistant = await poll(async () => {
        const result = await client.session.messages({ sessionID }, { throwOnError: true })
        const message = result.data.findLast((entry) => entry.info.role === "assistant" && !seen.has(entry.info.id))
        if (message?.info.role === "assistant" && message.info.error) throw new Error(JSON.stringify(message.info.error))
        return message?.parts.some((part) => part.type === "text") ? message.info : undefined
      }, `provider stream never reached the ${action} turn`)
      seen.add(assistant.id)
      if (action === "abort") {
        expect((await client.session.abort({ sessionID }, { throwOnError: true })).data).toBe(true)
      }
      if (action === "tui" || action === "tui-revert") {
        for (const invalid of ["killed", "bogus"]) {
          const url = new URL(`/session/${sessionID}/abort`, baseURL)
          url.searchParams.set("directory", tmp.path)
          url.searchParams.set("requester", invalid)
          expect((await fetch(url, { method: "POST" })).status).toBe(400)
        }
        expect((await client.session.abort({ sessionID, requester: action }, { throwOnError: true })).data).toBe(true)
      }
      if (action === "instance") {
        expect((await client.instance.dispose(undefined, { throwOnError: true })).data).toBe(true)
      }
      if (action === "global") {
        expect((await client.global.dispose({ throwOnError: true })).data).toBe(true)
      }
      if (action === "config") {
        await client.global.config.update({ config: { username: "abort-probe" } }, { throwOnError: true })
      }
      const completed = await poll(async () => {
        const result = await client.session.message({ sessionID, messageID: assistant.id }, { throwOnError: true })
        return result.data.info.role === "assistant" && result.data.info.time.completed ? result.data.info : undefined
      }, `${action} did not finalize its assistant`)
      const cancelled = action === "abort" || action === "tui" || action === "tui-revert"
      expect(completed.error).toEqual({
        name: "MessageAbortedError",
        data: {
          message: "Aborted",
          cause: cancelled ? "cancel" : "dispose",
          ...(cancelled
            ? { requester: action === "abort" ? "api" : action }
            : { dispose: action === "config" ? "config" : "api" }),
        },
      })
    }
  } finally {
    child.kill()
    await child.exited
    await errors
    provider.closeAllConnections()
    await new Promise<void>((resolve, reject) => provider.close((error) => (error ? reject(error) : resolve())))
  }
}, 90_000)
