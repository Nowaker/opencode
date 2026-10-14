import { expect, test } from "bun:test"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { tmpdir } from "../fixture/fixture"
import { MessageID } from "../../src/session/schema"

// Boot the production routes with a real plugin and private HOME/database.
// The optional binary runs the same proof against the installed artifact.
async function fixture() {
  const tmp = await tmpdir({ git: true })
  const plugin = path.join(tmp.path, "admission.js")
  await Bun.write(plugin, `export default async () => {
    let attempts = 0
    return {
    "chat.message": async (input, output) => {
      if (output.parts.some(part => part.text === "reject"))
        throw new Error("Admission fixture rejected the selected profile")
      if (output.parts.some(part => part.text === "partial"))
        output.parts[0].messageID = "msg_admission_missing"
      if (output.parts.some(part => part.text === "reject-once") && attempts++ === 0) {
        await Bun.write(${JSON.stringify(path.join(tmp.path, "ready"))}, "")
        while (!(await Bun.file(${JSON.stringify(path.join(tmp.path, "release"))}).exists())) await Bun.sleep(10)
        throw new Error("Admission fixture rejected once")
      }
      if (output.parts.some(part => part.text === "hold")) {
        await Bun.write(${JSON.stringify(path.join(tmp.path, "ready"))}, "")
        while (!(await Bun.file(${JSON.stringify(path.join(tmp.path, "release"))}).exists())) await Bun.sleep(10)
      }
    }
    }
  }`)
  await Bun.write(
    path.join(tmp.path, "opencode.json"),
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
    }),
  )
  const child = Bun.spawn(
    [
      ...(process.env.OPENCODE_PROMPT_PROBE_BINARY
        ? [process.env.OPENCODE_PROMPT_PROBE_BINARY]
        : [process.execPath, "run", "src/boot.ts"]),
      "serve",
      "--hostname",
      "127.0.0.1",
      "--port",
      "0",
    ],
    {
      cwd: path.resolve(import.meta.dir, "../.."),
      env: {
        PATH: process.env.PATH,
        HOME: tmp.path,
        XDG_CONFIG_HOME: path.join(tmp.path, "config"),
        XDG_DATA_HOME: path.join(tmp.path, "data"),
        XDG_CACHE_HOME: path.join(tmp.path, "cache"),
        XDG_STATE_HOME: path.join(tmp.path, "state"),
        OPENCODE_TOOLS_DATA_DIR: path.join(tmp.path, "tools"),
        OPENCODE_PLUGINS_DATA_DIR: path.join(tmp.path, "plugins"),
        OPENCODE_CONFIG: path.join(tmp.path, "opencode.json"),
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
        OPENCODE_TEST_HOME: tmp.path,
        OPENCODE_TEST_MANAGED_CONFIG_DIR: path.join(tmp.path, "managed"),
        OPENCODE_DISABLE_MODELS_FETCH: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const errors = new Response(child.stderr).text()
  const reader = child.stdout.getReader()
  const output = { text: "" }
  const decoder = new TextDecoder()
  try {
    const baseURL = await (async () => {
      while (true) {
        const next = await reader.read()
        if (next.done) throw new Error(`isolated admission server exited: ${await errors}`)
        output.text += decoder.decode(next.value)
        const match = output.text.match(/opencode server listening on (http:\/\/127\.0\.0\.1:\d+)/)
        if (match?.[1]) return match[1]
      }
    })()
    void (async () => {
      while (!(await reader.read()).done) {}
    })()
    const request = (pathname: string, body?: unknown) =>
      fetch(new URL(pathname, baseURL), {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", "x-opencode-directory": tmp.path },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20_000),
      })
    const created = await request("/session", { title: "Admission proof" })
    const session = await created.json()
    if (typeof session.id !== "string") throw new Error("fixture session was not created")
    return {
      directory: tmp.path,
      request: (suffix: string, body?: unknown) => request(`/session/${session.id}${suffix}`, body),
      quiescence: () => request("/global/quiescence"),
      async [Symbol.asyncDispose]() {
        await Bun.write(path.join(tmp.path, "release"), "")
        child.kill("SIGTERM")
        await child.exited
        await errors
        await tmp[Symbol.asyncDispose]()
      },
    }
  } catch (error) {
    child.kill("SIGTERM")
    await child.exited
    await tmp[Symbol.asyncDispose]()
    throw error
  }
}

test("async prompt rejects a throwing chat.message hook before durable admission", async () => {
  await using server = await fixture()
  const response = await server.request("/prompt_async", {
    messageID: MessageID.ascending(),
    parts: [{ type: "text", text: "reject" }],
    noReply: true,
  })
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({
    name: "PromptAdmissionError",
    data: { message: "Admission fixture rejected the selected profile" },
  })
  expect(await (await server.request("/message")).json()).toEqual([])
}, 60_000)

test("concurrent duplicate rejection never retries the rejected admission in the background", async () => {
  await using server = await fixture()
  const input = {
    messageID: MessageID.ascending(),
    parts: [{ type: "text", text: "reject-once" }],
    noReply: true,
  }
  const first = server.request("/prompt_async", input)
  const deadline = Date.now() + 20_000
  while (!(await Bun.file(path.join(server.directory, "ready")).exists())) {
    if (Date.now() > deadline) throw new Error("admission hook never started")
    await Bun.sleep(10)
  }
  const second = server.request("/prompt_async", input)
  while ((await (await server.quiescence()).json()).active < 4) {
    if (Date.now() > deadline) throw new Error("duplicate admission worker never started")
    await Bun.sleep(10)
  }
  await Bun.write(path.join(server.directory, "release"), "")
  const responses = await Promise.all([first, second])
  expect(responses.map((response) => response.status)).toEqual([400, 400])
  while ((await (await server.quiescence()).json()).active !== 0) {
    if (Date.now() > deadline) throw new Error("admission workers never settled")
    await Bun.sleep(10)
  }
  expect(await (await server.request("/message")).json()).toEqual([])
}, 60_000)

test("async noReply acknowledgement stores the user and all parts", async () => {
  await using server = await fixture()
  const messageID = MessageID.ascending()
  const response = await server.request("/prompt_async", {
    messageID,
    parts: [{ type: "text", text: "first" }, { type: "text", text: "second" }],
    noReply: true,
  })
  expect(response.status).toBe(204)
  expect(await (await server.request("/message")).json()).toMatchObject([
    { info: { id: messageID, role: "user" }, parts: [{ text: "first" }, { text: "second" }] },
  ])
}, 60_000)

test("async prompt cannot acknowledge while its admission hook is held", async () => {
  await using server = await fixture()
  const received = { response: false }
  const pending = server.request("/prompt_async", {
    parts: [{ type: "text", text: "hold" }], noReply: true,
  }).then((response) => {
    received.response = true
    return response
  })
  const deadline = Date.now() + 20_000
  while (!(await Bun.file(path.join(server.directory, "ready")).exists())) {
    if (Date.now() > deadline) throw new Error("admission hook never started")
    await Bun.sleep(10)
  }
  try {
    expect(await (await server.request("/message")).json()).toEqual([])
    expect(received.response).toBe(false)
  } finally {
    await Bun.write(path.join(server.directory, "release"), "")
    expect((await pending).status).toBe(204)
  }
}, 60_000)

test("async prompt never reports rejection after a user row was committed", async () => {
  await using server = await fixture()
  const messageID = MessageID.ascending()
  const response = await server.request("/prompt_async", {
    messageID,
    parts: [{ type: "text", text: "partial" }],
    noReply: true,
  })
  expect(response.status).toBe(204)
  expect(await (await server.request("/message")).json()).toMatchObject([
    { info: { id: messageID, role: "user" }, parts: [] },
  ])
}, 60_000)
