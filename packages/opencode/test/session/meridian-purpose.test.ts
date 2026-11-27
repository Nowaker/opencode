import { expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { tmpdir } from "../fixture/fixture"
import { testProviderConfig } from "../lib/test-provider"

const cli = path.resolve(import.meta.dir, "../../src/index.ts")
const modelID = "test-model"
const titleModelID = "title-model"
const timeout = 40_000

function fakeInference(overlapTitle = false) {
  const hits: {
    readonly model: unknown
    readonly client: string | null
    readonly purpose: string | null
    readonly affinity: string | null
    readonly fallback: string | null
    readonly source: string | null
  }[] = []
  const titleSent = Promise.withResolvers<void>()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/chat/completions") {
        return new Response(null, { status: 404 })
      }
      const body: { readonly model?: unknown; readonly stream?: boolean } = await request.json()
      hits.push({
        model: body.model,
        client: request.headers.get("x-meridian-client"),
        purpose: request.headers.get("x-meridian-purpose"),
        affinity: request.headers.get("x-session-affinity"),
        fallback: request.headers.get("x-meridian-session"),
        source: request.headers.get("x-meridian-source"),
      })
      if (!body.stream) {
        const configuration = { identifier: "meridian-helper", whenToUse: "Test", systemPrompt: "Help with testing" }
        return Response.json({
          id: "helper", model: modelID, object: "chat.completion", created: 1,
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(configuration) }, finish_reason: "stop" }],
        })
      }
      if (overlapTitle && hits.length === 1 && body.model !== titleModelID) await titleSent.promise
      if (body.model === titleModelID) titleSent.resolve()
      const chunk = (delta: Record<string, string>, finish: string | null) =>
        `data: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
      return new Response(chunk({ role: "assistant", content: "Fixture reply" }, null) + chunk({}, "stop") + "data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      })
    },
  })
  const baseURL = new URL("/v1", server.url).href
  return {
    url: new URL("/v1/chat/completions", server.url).href,
    baseURL,
    hits,
    [Symbol.asyncDispose]: () => { titleSent.resolve(); return server.stop(true) },
  }
}

function isolatedEnv(home: string, config: object, endpoint: string) {
  return {
    HOME: home,
    USERPROFILE: home,
    XDG_CACHE_HOME: path.join(home, "cache"),
    XDG_CONFIG_HOME: path.join(home, "config"),
    XDG_DATA_HOME: path.join(home, "data"),
    XDG_STATE_HOME: path.join(home, "state"),
    OPENCODE_TEST_HOME: home,
    OPENCODE_TEST_MANAGED_CONFIG_DIR: path.join(home, "managed"),
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_AUTOCOMPACT: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    OPENCODE_AUTH_CONTENT: JSON.stringify({ rewrite: { type: "api", key: "fixture" } }),
    VIBETERM_MERIDIAN_ATTRIBUTION_ENDPOINTS: JSON.stringify([endpoint]),
  }
}

async function isolatedHome() {
  return tmpdir({ init: async (directory) => {
    const config = path.join(directory, "config", "opencode")
    await mkdir(path.join(config, "node_modules"), { recursive: true })
    // Config normally installs the plugin SDK in this directory. No fixture plugin imports it.
    await Bun.write(path.join(config, "package-lock.json"), JSON.stringify({
      packages: { "": { dependencies: { "@opencode-ai/plugin": "0.0.0-fixture" } } },
    }))
  } })
}

test("a source v1 process attributes overlapping title and chat, child turns, and manual compaction at the wire", async () => {
  await using home = await isolatedHome()
  await using trusted = fakeInference(true)
  await using unlisted = fakeInference()

  const plugin = path.join(home.path, "rewrite.mjs")
  const capability = path.join(home.path, "capability.json")
  await Bun.write(plugin, `export default async (input) => {
    await Bun.write(${JSON.stringify(capability)}, JSON.stringify({ promptOrigin: input.promptOrigin }))
    const injected = { client: "oh-my-openagent", version: "not-the-producer", purpose: "review" }
    return {
      "chat.message": async (_input, out) => { out.message.promptOrigin = injected },
      "experimental.chat.messages.transform": async (_input, out) => {
        for (const message of out.messages) {
          if (message.info.role !== "user") continue
          if (message.info.promptOrigin) delete message.info.promptOrigin
          else message.info.promptOrigin = injected
        }
      },
      auth: {
        provider: "rewrite", methods: [], loader: async () => ({
          fetch: async (_input, init) => fetch(${JSON.stringify(unlisted.url)}, init),
        }),
      },
    }
  }`)
  const config = testProviderConfig(trusted.baseURL)
  const main = config.provider.test
  const configured = {
    ...config,
    snapshot: false,
    plugin: [pathToFileURL(plugin).href],
    enabled_providers: ["test", "direct", "rewrite"],
    agent: { title: { model: `test/${titleModelID}` } },
    provider: {
      test: { ...main, models: {
        [modelID]: { ...main.models[modelID], headers: { "x-meridian-source": "fixture" } },
        [titleModelID]: { ...main.models[modelID], id: titleModelID, name: "Title fixture" },
      } },
      direct: { ...main, id: "direct", options: { ...main.options, baseURL: unlisted.baseURL } },
      rewrite: { ...main, id: "rewrite" },
    },
  }
  const child = Bun.spawn([process.execPath, "--no-env-file", "run", cli, "serve", "--hostname", "127.0.0.1", "--port", "0"], {
    cwd: home.path,
    env: isolatedEnv(home.path, configured, trusted.url),
    stdin: "ignore", stderr: "pipe", stdout: "pipe", signal: AbortSignal.timeout(timeout - 2_000),
  })
  const errors = new Response(child.stderr).text()
  const stdout = child.stdout.pipeThrough(new TextDecoderStream()).getReader()
  try {
    let output = ""
    let baseURL: string | undefined
    while (!baseURL) {
      const next = await stdout.read()
      if (next.done) throw new Error(`Isolated OpenCode process did not listen: ${await errors}`)
      output += next.value
      baseURL = output.match(/opencode server listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1]
    }

    const api = createOpencodeClient({ baseUrl: baseURL, directory: home.path })
    const call = { throwOnError: true, signal: AbortSignal.timeout(timeout - 3_000) } as const
    const root = await api.session.create({}, call)
    const origin = { client: "oh-my-openagent", version: "5.0.0+fixture", purpose: "helper" } as const
    const prompt = (sessionID: string, providerID = "test", promptOrigin?: typeof origin) => api.session.prompt({
      sessionID, agent: "build", model: { providerID, modelID }, promptOrigin, parts: [{ type: "text", text: "fixture prompt" }],
    }, call)
    const result = await prompt(root.data.id, "test", origin)
    expect(result.data.info.error).toBeUndefined()
    expect(await Bun.file(capability).json()).toEqual({ promptOrigin: 1 })
    expect(trusted.hits.toSorted((a, b) => String(a.model).localeCompare(String(b.model)))).toEqual([
      { model: modelID, client: "oh-my-openagent/5.0.0+fixture", purpose: "helper", affinity: root.data.id, fallback: null, source: "fixture" },
      { model: titleModelID, client: "opencode/local", purpose: "title", affinity: root.data.id, fallback: null, source: null },
    ])

    const childSession = await api.session.create({ parentID: root.data.id }, call)
    const ordinary = await prompt(childSession.data.id)
    expect(ordinary.data.info.error).toBeUndefined()
    expect(trusted.hits.at(-1)).toMatchObject({ client: "opencode/local", purpose: "subagent", affinity: childSession.data.id })

    const historyOrigins = async (sessionID: string, messageID: string) => {
      const list = await api.session.messages({ sessionID }, call)
      const page = await api.session.messages({ sessionID, limit: 1, order: "asc" }, call)
      const finalPage = await api.session.messages({ sessionID, limit: 100 }, call)
      const single = await api.session.message({ sessionID, messageID }, call)
      expect(page.response.headers.get("x-next-cursor")).not.toBeNull()
      expect(finalPage.response.headers.get("x-next-cursor")).toBeNull()
      const rows = [list.data.find(({ info }) => info.id === messageID), page.data[0],
        finalPage.data.find(({ info }) => info.id === messageID), single.data]
      return rows.map((row) => {
        expect(row?.info.id).toBe(messageID)
        return row?.info.role === "user" ? row.info.promptOrigin ?? null : null
      })
    }
    expect({
      tagged: await historyOrigins(root.data.id, result.data.info.parentID),
      ordinary: await historyOrigins(childSession.data.id, ordinary.data.info.parentID),
    }).toEqual({ tagged: [origin, origin, origin, origin], ordinary: [null, null, null, null] })

    const compacted = await api.session.summarize({ sessionID: root.data.id, providerID: "test", modelID, auto: false }, call)
    expect(compacted.data).toBe(true)
    expect(trusted.hits.filter((entry) => entry.purpose === "compaction")).toEqual([
      { model: modelID, client: "opencode/local", purpose: "compaction", affinity: root.data.id, fallback: null, source: "fixture" },
    ])

    const initialTrustedCount = trusted.hits.length
    for (const providerID of ["direct", "rewrite"]) {
      const target = await api.session.create({ title: providerID }, call)
      expect((await prompt(target.data.id, providerID, origin)).data.info.error).toBeUndefined()
    }
    expect(trusted.hits).toHaveLength(initialTrustedCount)
    expect(unlisted.hits.map(({ client, purpose, fallback }) => ({ client, purpose, fallback }))).toEqual([
      { client: null, purpose: null, fallback: null },
      { client: null, purpose: null, fallback: null },
    ])
  } finally {
    if (child.exitCode === null) child.kill(9)
    await child.exited
    await stdout.cancel()
    await errors
  }
}, timeout)

test("agent create attributes standalone generation as helper without inventing a session", async () => {
  await using home = await isolatedHome()
  await using trusted = fakeInference()
  const child = Bun.spawn([process.execPath, "--no-env-file", "run", cli, "agent", "create",
    "--path", home.path, "--description", "Fixture generator", "--mode", "primary",
    "--permissions=read", "--model", `test/${modelID}`,
  ], {
    cwd: home.path,
    env: isolatedEnv(home.path, testProviderConfig(trusted.baseURL), trusted.url),
    stdin: "ignore", stdout: "pipe", stderr: "pipe", signal: AbortSignal.timeout(timeout - 2_000),
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`Agent create exited with ${exitCode}\n${stdout}\n${stderr}`)
  expect(await Bun.file(path.join(home.path, "agents", "meridian-helper.md")).exists()).toBe(true)
  expect(trusted.hits).toEqual([
    { model: modelID, client: "opencode/local", purpose: "helper", affinity: null, fallback: null, source: null },
  ])
}, timeout)
