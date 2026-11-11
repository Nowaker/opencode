import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { Schema } from "effect"
import { createServer } from "node:net"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { isolatedEnv } from "./fixture/environment"

const Ready = Schema.Struct({ url: Schema.String })
const Created = Schema.Struct({ data: Schema.Struct({ id: Schema.String }) })

test.each([
  { mode: "serve", args: [], setting: undefined, count: 1 },
  { mode: "stdio", args: ["--stdio"], setting: undefined, count: 1 },
  { mode: "disabled", args: ["--stdio"], setting: "0", count: 0 },
])("$mode retains durable events according to OPENCODE_EVENTS_PERSIST", async ({ args, setting, count }) => {
  await using tmp = await tmpdir()
  const database = path.join(tmp.path, "events-v2.db")
  const listener = createServer()
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject)
    listener.listen(0, "127.0.0.1", resolve)
  })
  const address = listener.address()
  if (!address || typeof address === "string") throw new Error("missing fixture listener address")
  await new Promise<void>((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve())))
  const child = Bun.spawn(
    [
      process.execPath,
      "run",
      "src/index.ts",
      "serve",
      ...args,
      "--hostname",
      "127.0.0.1",
      "--port",
      String(address.port),
    ],
    {
      cwd: path.resolve(import.meta.dir, ".."),
      env: isolatedEnv(tmp.path, {
        OPENCODE_DB: database,
        OPENCODE_PASSWORD: "event-persistence-fixture",
        OPENCODE_EVENTS_PERSIST: setting,
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
        OPENCODE_CONFIG_PROJECT_DISABLE: "1",
        OPENCODE_DISABLE_CLAUDE_CODE: "1",
        OPENCODE_DISABLE_FFF: "1",
        OPENCODE_TOOLS_DATA_DIR: path.join(tmp.path, "tools"),
        OPENCODE_PLUGINS_DATA_DIR: path.join(tmp.path, "plugins"),
      }),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const errors = new Response(child.stderr).text()
  const deadline = setTimeout(() => child.kill("SIGKILL"), 25_000)
  try {
    const decoder = new TextDecoder()
    let pending = ""
    const ready = await (async () => {
      for await (const bytes of child.stdout) {
        pending += decoder.decode(bytes, { stream: true })
        const lines = pending.split("\n")
        pending = lines.pop() ?? ""
        for (const line of lines) {
          if (line.startsWith("{")) return Schema.decodeUnknownSync(Ready)(JSON.parse(line)).url
          if (line.startsWith("server listening on ")) return line.slice("server listening on ".length)
        }
      }
      throw new Error(`server exited before readiness: ${await errors}`)
    })()
    const response = await fetch(new URL("/api/session", ready), {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from("opencode:event-persistence-fixture").toString("base64")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "Durable event fixture" }),
      signal: AbortSignal.timeout(10_000),
    })
    expect(response.status).toBe(200)
    const session = Schema.decodeUnknownSync(Created)(await response.json())
    using db = new Database(database, { readonly: true })
    expect(db.query("SELECT type, seq FROM event WHERE aggregate_id = ?").all(session.data.id)).toEqual(
      count === 1 ? [{ type: "session.created.1", seq: 0 }] : [],
    )
    expect(db.query("SELECT seq FROM event_sequence WHERE aggregate_id = ?").get(session.data.id)).toEqual({ seq: 0 })
  } finally {
    child.stdin.end()
    child.kill("SIGTERM")
    await child.exited
    clearTimeout(deadline)
    await errors
  }
})
