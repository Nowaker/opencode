import { expect, test } from "bun:test"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { tmpdir } from "../fixture/fixture"
import { createOpencodeClient } from "../../../sdk/js/src/v2/client"
import { MessageID } from "../../src/session/schema"

test("isolated engine driver refuses busy retirement, fences HTTP admission, and releases by CAS", async () => {
  await using tmp = await tmpdir({ git: true })
  const config = path.join(tmp.path, "opencode.json")
  const marker = path.join(tmp.path, "sealed-execution")
  const ready = path.join(tmp.path, "shell-ready")
  const finish = path.join(tmp.path, "shell-finish")
  const plugin = path.join(tmp.path, "owner-probe.js")
  const capabilityProbe = path.join(tmp.path, "owner-probe.json")
  const disposalReady = path.join(tmp.path, "disposal-ready")
  const disposalFinish = path.join(tmp.path, "disposal-finish")
  const disposed = path.join(tmp.path, "disposed")
  await Bun.write(plugin, `export default async (input) => {
    const control = input.ownerQuiescence
    await Bun.write(${JSON.stringify(capabilityProbe)}, JSON.stringify({
      available: control !== undefined,
      acquisition: control?.acquire().status,
    }))
    return { dispose: async () => {
      await Bun.write(${JSON.stringify(disposalReady)}, "")
      while (!(await Bun.file(${JSON.stringify(disposalFinish)}).exists())) await Bun.sleep(10)
      await Bun.write(${JSON.stringify(disposed)}, "")
    } }
  }`)
  await Bun.write(
    config,
    JSON.stringify({
      model: "test/probe",
      plugin: [pathToFileURL(plugin).href],
      provider: {
        test: {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "http://127.0.0.1:1/v1" },
          models: { probe: { name: "Probe", limit: { context: 16384, output: 1024 } } },
        },
      },
      command: { probe: { native: true, template: `!\`touch '${marker}'\`` } },
    }),
  )
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith("OPENCODE_CONFIG") || key === "OPENCODE_TUI_CONFIG" || key === "OPENCODE_SERVER_PASSWORD")
      delete env[key]
  }
  const child = Bun.spawn([process.execPath, "run", "src/boot.ts", "serve", "--hostname", "127.0.0.1", "--port", "0"], {
    cwd: path.resolve(import.meta.dir, "../.."),
    env: {
      ...env,
      HOME: tmp.path,
      XDG_CONFIG_HOME: path.join(tmp.path, "config"),
      XDG_DATA_HOME: path.join(tmp.path, "data"),
      XDG_CACHE_HOME: path.join(tmp.path, "cache"),
      XDG_STATE_HOME: path.join(tmp.path, "state"),
      OPENCODE_TOOLS_DATA_DIR: path.join(tmp.path, "tools"),
      OPENCODE_PLUGINS_DATA_DIR: path.join(tmp.path, "plugins"),
      OPENCODE_CONFIG: config,
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_TEST_HOME: tmp.path,
      OPENCODE_TEST_MANAGED_CONFIG_DIR: path.join(tmp.path, "managed"),
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const errors = new Response(child.stderr).text()
  try {
    const reader = child.stdout.getReader()
    const decoder = new TextDecoder()
    const output = { text: "" }
    const baseURL = await (async () => {
      while (true) {
        const next = await reader.read()
        if (next.done) throw new Error(`isolated server exited: ${await errors}`)
        output.text += decoder.decode(next.value)
        const match = output.text.match(/opencode server listening on (http:\/\/127\.0\.0\.1:\d+)/)
        if (match?.[1]) return match[1]
      }
    })()
    const client = createOpencodeClient({ baseUrl: baseURL, directory: tmp.path })
    const request = (pathname: string, body: unknown) =>
      fetch(new URL(pathname, baseURL), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-opencode-directory": tmp.path },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      })
    const created = await client.session.create({ title: "Driver" }, { throwOnError: true })
    const sessionID = created.data.id
    expect(await Bun.file(capabilityProbe).json()).toEqual({ available: true, acquisition: "busy" })
    const shell = request(`/session/${sessionID}/shell`, {
      agent: "build",
      command: `touch '${ready}'; while [ ! -f '${finish}' ]; do sleep 0.01; done; printf owned-work-completed`,
    })
    const deadline = Date.now() + 10_000
    while (!(await Bun.file(ready).exists())) {
      if (Date.now() > deadline) throw new Error("shell did not signal readiness")
      await Bun.sleep(10)
    }
    const busy = await client.global.quiescence.acquire()
    expect(busy.response.status).toBe(409)
    await Bun.write(finish, "")
    const completed = await shell
    expect(completed.status).toBe(200)
    expect(await completed.text()).toContain("owned-work-completed")
    const before = await client.session.messages({ sessionID }, { throwOnError: true })
    const acquired = await (async () => {
      const deadline = Date.now() + 10_000
      while (true) {
        const result = await client.global.quiescence.acquire()
        if (result.data) return result
        if (result.response.status !== 409 || Date.now() > deadline) throw new Error("owner did not become idle")
        await Bun.sleep(10)
      }
    })()
    const capability = acquired.data
    try {
      const status = await client.global.quiescence.status({ throwOnError: true })
      expect(status.data).toMatchObject({
        sealed: true,
        active: 0,
        ownerID: capability.ownerID,
        generation: capability.generation,
      })
      const admissions = [
        ["message", { parts: [{ type: "text", text: "input" }], noReply: true }],
        ["prompt_async", { parts: [{ type: "text", text: "input" }] }],
        ["command", { command: "probe", arguments: "" }],
        ["shell", { agent: "build", command: `touch '${marker}'` }],
        ["summarize", { providerID: "test", modelID: "probe" }],
        ["init", { providerID: "test", modelID: "probe", messageID: MessageID.ascending() }],
      ] as const
      for (const [route, body] of admissions) {
        const response = await request(`/session/${sessionID}/${route}`, body)
        expect(response.status).toBe(409)
        expect(await response.json()).toMatchObject({ _tag: "OwnerSealed", generation: capability.generation })
      }
      const after = await client.session.messages({ sessionID }, { throwOnError: true })
      expect(after.data).toEqual(before.data)
      expect(await Bun.file(marker).exists()).toBe(false)
      const beforeConfig = await fetch(new URL("/global/config", baseURL)).then((response) => response.json())
      const sealedConfig = await fetch(new URL("/global/config", baseURL), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "quiescence-regression" }),
      })
      expect(sealedConfig.status).toBe(409)
      expect(await fetch(new URL("/global/config", baseURL)).then((response) => response.json())).toEqual(beforeConfig)
      expect(await Bun.file(disposalReady).exists()).toBe(false)
      const stale = await client.global.quiescence.release({
        ownerQuiescenceCapability: { ...capability, generation: capability.generation + 1 },
      })
      expect(stale.response.status).toBe(409)
    } finally {
      await client.global.quiescence.release({ ownerQuiescenceCapability: capability }, { throwOnError: true })
    }
    const resumed = await request(`/session/${sessionID}/message`, {
      parts: [{ type: "text", text: "input" }],
      noReply: true,
    })
    expect(resumed.status).toBe(200)
    const updated = await fetch(new URL("/global/config", baseURL), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "quiescence-regression" }),
    })
    expect(updated.status).toBe(200)
    const disposalDeadline = Date.now() + 10_000
    while (!(await Bun.file(disposalReady).exists())) {
      if (Date.now() > disposalDeadline) throw new Error("config disposal did not start")
      await Bun.sleep(10)
    }
    expect((await client.global.quiescence.acquire()).response.status).toBe(409)
    await Bun.write(disposalFinish, "")
    while (!(await Bun.file(disposed).exists())) {
      if (Date.now() > disposalDeadline) throw new Error("config disposal did not settle")
      await Bun.sleep(10)
    }
    console.log(
      "owner driver: busy refused; existing shell completed; 6 admissions fenced before writes; sealed config unchanged; config disposal stayed busy; stale CAS refused; release restored admission",
    )
  } finally {
    await Bun.write(finish, "")
    await Bun.write(disposalFinish, "")
    child.kill("SIGTERM")
    await child.exited
    await errors
  }
}, 60_000)
