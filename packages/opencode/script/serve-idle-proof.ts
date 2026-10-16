import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import {
  alive,
  fixtureProcesses,
  identity,
  sample,
  unusedPort,
  waitFor,
  type ProcessIdentity,
} from "./serve-idle-probe"

if (process.platform !== "linux") throw new Error("this process/RSS proof requires Linux /proc")
const output = process.argv[2]
if (!output) throw new Error("usage: bun script/serve-idle-proof.ts <report.json> [--retained-control]")
const retained = process.argv.includes("--retained-control")
const packageDir = path.resolve(import.meta.dir, "..")
const tmp = path.resolve(packageDir, "../../tmp")
await mkdir(tmp, { recursive: true })
const root = await mkdtemp(path.join(tmp, "serve-idle-proof-"))
const owned: ProcessIdentity[] = []
const gate = Promise.withResolvers<void>()
const calls = { count: 0 }
const encoder = new TextEncoder()
const llm = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (request.method === "GET") return Response.json({ object: "list", data: [] })
    await request.json()
    calls.count++
    let cancelled = false
    return new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          const chunk = (delta: object, finish_reason: string | null) =>
            encoder.encode(
              `data: ${JSON.stringify({
                id: "idle-proof",
                object: "chat.completion.chunk",
                created: 0,
                model: "probe",
                choices: [{ index: 0, delta, finish_reason }],
              })}\n\n`,
            )
          controller.enqueue(chunk({ role: "assistant", content: "held" }, null))
          await gate.promise
          if (cancelled) return
          controller.enqueue(chunk({}, "stop"))
          controller.enqueue(encoder.encode("data: [DONE]\n\n"))
          controller.close()
        },
        cancel() {
          cancelled = true
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    )
  },
})
const directories = [path.join(root, "active"), path.join(root, "idle")]
const config = path.join(root, "config", "opencode")
await Promise.all([...directories, config].map((directory) => mkdir(directory, { recursive: true })))
await Bun.write(
  path.join(config, "opencode.json"),
  JSON.stringify({
    server: { instanceIdleTimeout: retained ? 0 : 1000 },
    model: "test/probe",
    small_model: "test/probe",
    provider: {
      test: {
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: new URL("v1", llm.url).href },
        models: { probe: { name: "Probe", limit: { context: 16384, output: 1024 } } },
      },
    },
    agent: { title: { disable: true }, summary: { disable: true } },
    mcp: {
      lifetime: {
        type: "local",
        command: [process.execPath, path.join(packageDir, "test/fixture/mcp-lifecycle-stdio.ts")],
        environment: { MCP_LIFECYCLE_PID_FILE: "mcp.pid", MCP_LIFECYCLE_CHILD_PID_FILE: "mcp-child.pid" },
      },
    },
  }),
)
const port = await unusedPort()
const child = Bun.spawn(
  [process.execPath, "run", "src/boot.ts", "serve", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    cwd: packageDir,
    env: {
      PATH: process.env.PATH,
      HOME: root,
      OPENCODE_TEST_HOME: root,
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_STATE_HOME: path.join(root, "state"),
      OPENCODE_TOOLS_DATA_DIR: path.join(root, "tools"),
      OPENCODE_PLUGINS_DATA_DIR: path.join(root, "plugins"),
      OPENCODE_TEST_MANAGED_CONFIG_DIR: path.join(root, "managed"),
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
      OPENCODE_DISABLE_MODELS_FETCH: "1",
      OPENCODE_MODELS_PATH: path.join(packageDir, "test/tool/fixtures/models-api.json"),
    },
    stdout: "pipe",
    stderr: "pipe",
  },
)
const stdout = new Response(child.stdout).text()
const stderr = new Response(child.stderr).text()
const report: Record<string, unknown> = {
  mode: retained ? "retained-control" : "idle-expiry",
  timeout: retained ? 0 : 1000,
}
const request = async (directory: string, pathname: string, body?: object) => {
  const response = await fetch(new URL(pathname, `http://127.0.0.1:${port}`), {
    method: body ? "POST" : "GET",
    headers: { "x-opencode-directory": directory, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`isolated proof HTTP ${response.status}: ${pathname}`)
  return response
}

try {
  const parent = await identity(child.pid)
  if (!parent) throw new Error("isolated source server did not start")
  owned.push(parent)
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error("isolated source server exited before readiness")
    return fetch(new URL("/global/health", `http://127.0.0.1:${port}`), { signal: AbortSignal.timeout(200) })
      .then((response) => (response.ok ? true : undefined))
      .catch(() => undefined)
  }, "isolated source server did not become ready")
  const active = directories[0]
  const idle = directories[1]
  if (!active || !idle) throw new Error("missing isolated proof directories")
  await (await request(active, "/mcp")).json()
  const activeProcesses = await fixtureProcesses(active)
  owned.push(...activeProcesses)
  const session: unknown = await (await request(active, "/session", { title: "Idle lifetime proof" })).json()
  if (typeof session !== "object" || session === null || !("id" in session) || typeof session.id !== "string") {
    throw new Error("isolated proof session was not created")
  }
  const accepted = await request(active, `/session/${session.id}/prompt_async`, {
    parts: [{ type: "text", text: "exercise idle lifetime" }],
  })
  assert.equal(accepted.status, 204)
  await waitFor(async () => (calls.count > 0 ? true : undefined), "model request did not start")
  await (await request(idle, "/mcp")).json()
  const idleProcesses = await fixtureProcesses(idle)
  owned.push(...idleProcesses)
  report.loaded = await sample(owned)
  await Bun.sleep(2500)
  report.activeDuringTurn = await sample(activeProcesses)
  report.idleAfterDeadline = await sample(idleProcesses)
  report.afterIdleTotal = await sample(owned)
  assert.equal((await sample(activeProcesses)).processes, 2, "active MCP or descendant was retired")
  assert.equal((await sample(idleProcesses)).processes, retained ? 2 : 0, "idle MCP scope was retained")
  gate.resolve()
  await waitFor(async () => {
    const status: unknown = await (await request(active, "/global/quiescence")).json()
    return typeof status === "object" && status !== null && "active" in status && status.active === 0 ? true : undefined
  }, "asynchronous session work did not settle")
  await Bun.sleep(2500)
  report.afterTurn = await sample(activeProcesses)
  report.afterTurnTotal = await sample(owned)
  assert.equal((await sample(activeProcesses)).processes, retained ? 2 : 0, "completed session retained MCP processes")
  if (!retained) {
    await (await request(active, "/mcp")).json()
    const replacement = await fixtureProcesses(active)
    owned.push(...replacement)
    assert.notEqual(replacement[0]?.pid, activeProcesses[0]?.pid)
    report.reloaded = await sample(replacement)
  }
  report.passed = true
} finally {
  gate.resolve()
  const recorded = await Promise.all(
    directories.flatMap((directory) =>
      ["mcp.pid", "mcp-child.pid"].map(async (name) => {
        const file = Bun.file(path.join(directory, name))
        return (await file.exists()) ? identity(Number(await file.text())) : undefined
      }),
    ),
  )
  for (const target of recorded) {
    if (!target || owned.some((item) => item.pid === target.pid)) continue
    if (target.parent === child.pid || recorded.some((item) => item?.pid === target.parent)) owned.push(target)
  }
  if (child.exitCode === null) child.kill("SIGTERM")
  const kill = setTimeout(() => child.kill("SIGKILL"), 5000)
  try {
    await child.exited
  } finally {
    clearTimeout(kill)
  }
  await Promise.all([stdout, stderr])
  for (const target of owned.slice(1)) {
    if (await alive(target)) process.kill(target.pid, "SIGKILL")
  }
  await waitFor(
    async () => ((await sample(owned)).processes === 0 ? true : undefined),
    "owned proof processes did not exit",
  )
  await llm.stop(true)
  report.cleaned = true
  await Bun.write(path.resolve(output), JSON.stringify(report, null, 2) + "\n")
  await rm(root, { recursive: true, force: true })
}
console.log(JSON.stringify(report))
