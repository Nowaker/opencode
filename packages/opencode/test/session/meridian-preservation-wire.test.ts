import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { createProviderFixture } from "../fixture/phase2-provider-fixture"

const timeout = 60_000
const header = "x-meridian-cybersec-preservation"
const reply = "Fixture streamed reply"
const claudeModel = "claude-preservation-fixture"
const gptModel = "gpt-preservation-fixture"

function inference() {
  const fixture = createProviderFixture(gptModel)
  return {
    ...fixture,
    baseURL: new URL("/v1", fixture.url).href,
    [Symbol.asyncDispose]: () => fixture.close(),
  }
}

test.each(["ai-sdk", "native"] as const)("sends session preservation only on allowlisted plain Claude streams (%s)", async (runtime) => {
  const native = runtime === "native"
  await using home = await tmpdir({ init: async (dir) => {
    const config = path.join(dir, "config", "opencode")
    await mkdir(path.join(config, "node_modules"), { recursive: true })
    // Match the source-v1 attribution fixture: no plugin SDK install on boot.
    await Bun.write(path.join(config, "package-lock.json"), JSON.stringify({
      packages: { "": { dependencies: { "@opencode-ai/plugin": "0.0.0-fixture" } } },
    }))
  } })
  await using trusted = inference()
  await using wrongPath = inference()
  await using direct = inference()

  const model = {
    name: "Fixture model",
    limit: { context: 100_000, output: 10_000 },
  }
  const anthropic = {
    npm: "@ai-sdk/anthropic",
    api: trusted.baseURL,
    options: { apiKey: "fixture-only" },
    models: {
      [claudeModel]: native ? { ...model, headers: { [header]: "off" } } : model,
    },
  }
  const provider = {
    anthropic: {
      ...anthropic,
      models: {
        ...anthropic.models,
        "claude-wrong-path": { ...model, provider: { api: wrongPath.baseURL } },
        "claude-direct": { ...model, provider: { api: direct.baseURL } },
      },
    },
    "anthropic-restricted": anthropic,
    "anthropic-cybersec": anthropic,
    openai: {
      npm: "@ai-sdk/openai",
      options: { apiKey: "fixture-only", baseURL: trusted.baseURL },
      models: { [gptModel]: model },
    },
  }
  const databasePath = path.join(home.path, "opencode.db")
  const cli = path.resolve(import.meta.dir, "../../src/index.ts")
  const child = Bun.spawn(
    [
      process.execPath, "--no-env-file", "run", cli,
      ...(native ? ["--print-logs"] : []), "serve",
      "--hostname", "127.0.0.1", "--port", "0",
    ],
    {
      cwd: home.path,
      env: {
        HOME: home.path,
        USERPROFILE: home.path,
        XDG_CACHE_HOME: path.join(home.path, "cache"),
        XDG_CONFIG_HOME: path.join(home.path, "config"),
        XDG_DATA_HOME: path.join(home.path, "data"),
        XDG_STATE_HOME: path.join(home.path, "state"),
        OPENCODE_TEST_HOME: home.path,
        OPENCODE_TEST_MANAGED_CONFIG_DIR: path.join(home.path, "managed"),
        OPENCODE_DB: databasePath,
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        OPENCODE_DISABLE_AUTOCOMPACT: "1",
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
        OPENCODE_DISABLE_MODELS_FETCH: "1",
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
        OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
        OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
        OPENCODE_AUTH_CONTENT: "{}",
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          provider,
          enabled_providers: Object.keys(provider),
          snapshot: false,
          formatter: false,
          lsp: false,
        }),
        VIBETERM_MERIDIAN_ATTRIBUTION_ENDPOINTS: JSON.stringify([
          new URL("/v1/messages", trusted.url).href,
          new URL("/v1/responses", trusted.url).href,
          new URL("/messages", wrongPath.url).href,
        ]),
        ...(native ? { OPENCODE_EXPERIMENTAL_NATIVE_LLM: "1" } : {
          // Even an exact routing transport match is not attribution allowlisting.
          VIBETERM_AUTO_SWITCH_CLAUDE_INFERENCE_URL: new URL("/v1/messages", wrongPath.url).href,
        }),
      },
      stdin: "ignore",
      stderr: "pipe",
      stdout: "pipe",
      signal: AbortSignal.timeout(timeout - 2_000),
    },
  )
  const errors = new Response(child.stderr).text()
  const stdout = child.stdout.pipeThrough(new TextDecoderStream()).getReader()
  try {
    let output = ""
    let baseURL: string | undefined
    while (!baseURL) {
      const next = await stdout.read()
      if (next.done) {
        throw new Error(`Isolated OpenCode did not listen: ${await errors}`)
      }
      output += next.value
      baseURL = output.match(
        /opencode server listening on (http:\/\/127\.0\.0\.1:\d+)/,
      )?.[1]
    }
    const api = createOpencodeClient({ baseUrl: baseURL, directory: home.path })
    const call = {
      throwOnError: true,
      signal: AbortSignal.timeout(timeout - 3_000),
    } as const
    const plain = { providerID: "anthropic", modelID: claudeModel, wire: "anthropic" } as const
    const cases = [
      { ...plain, preference: "on", receiver: trusted, expected: "on" },
      { ...plain, preference: "off", receiver: trusted, expected: "off" },
      { ...plain, preference: "inherit", receiver: trusted, expected: undefined },
    ] as const
    const sdkControls = [
      {
        ...plain, modelID: "claude-wrong-path", receiver: wrongPath,
        preference: "on", expected: undefined,
      },
      {
        ...plain, modelID: "claude-direct", receiver: direct,
        preference: "off", expected: undefined,
      },
      {
        ...plain, providerID: "anthropic-restricted", receiver: trusted,
        preference: "on", expected: undefined,
      },
      {
        ...plain, providerID: "anthropic-cybersec", receiver: trusted,
        preference: "off", expected: undefined,
      },
      {
        providerID: "openai", modelID: gptModel, wire: "openai", receiver: trusted,
        preference: "on", expected: undefined,
      },
    ] as const

    const turns = native ? cases : [...cases, ...sdkControls]
    for (const row of turns) {
      const session = await api.session.create({ title: "Provider wire fixture" }, call)
      const sessionID = session.data.id
      // Seed only the wire test's prerequisite. The owner API does not exist on the base.
      {
        using db = new Database(databasePath, { create: false })
        db.exec("PRAGMA busy_timeout = 5000")
        const metadata = { vibeterm: {
          cybersecPreservation: {
            sessionId: sessionID, preference: row.preference, revision: 1,
          },
        } }
        expect(db.run(
          "UPDATE session SET metadata = json_patch(COALESCE(metadata, '{}'), ?) WHERE id = ?",
          [JSON.stringify(metadata), sessionID],
        ).changes).toBe(1)
      }
      row.receiver.enqueue(row.wire, reply)

      const result = await api.session.prompt({
        sessionID,
        agent: "build",
        model: { providerID: row.providerID, modelID: row.modelID },
        parts: [{ type: "text", text: "Reply with the fixture response." }],
      }, call)

      expect(result.data.info.error).toBeUndefined()
      expect(result.data.parts.flatMap((part) =>
        part.type === "text" ? [part.text] : [],
      )).toEqual([reply])
    }

    for (const receiver of [trusted, wrongPath, direct]) {
      expect(receiver.unexpected).toEqual([])
      expect(receiver.captured.map((request) => ({
        method: request.method,
        path: request.path,
        model: request.body.model,
        stream: request.body.stream,
        preservation: request.headers[header],
      }))).toEqual(turns.filter((row) => row.receiver === receiver).map((row) => ({
        method: "POST",
        path: row.wire === "anthropic" ? "/v1/messages" : "/v1/responses",
        model: row.modelID,
        stream: true,
        preservation: row.expected,
      })))
    }
  } finally {
    if (child.exitCode === null) child.kill(9)
    await child.exited
    await stdout.cancel()
    await errors
  }
  if (native) {
    const selected = (await errors).split("\n")
      .filter((line) => line.includes('message="llm runtime selected"'))
      .map((line) => line.split(" "))
      .filter((fields) => fields.includes("llm.provider=anthropic") && fields.includes(`llm.model=${claudeModel}`))
      .map((fields) => fields.find((field) => field.startsWith("llm.runtime=")))
    expect(selected).toEqual(["llm.runtime=native", "llm.runtime=native", "llm.runtime=native"])
  }
}, timeout)
