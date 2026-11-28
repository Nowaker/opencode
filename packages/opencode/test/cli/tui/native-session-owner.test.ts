import { expect } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { Effect } from "effect"
import { mkdir, realpath } from "node:fs/promises"
import path from "node:path"
import { cliIt, testModelID } from "../../lib/cli-process"
import { pollWithTimeout } from "../../lib/effect"
import { testProviderConfig } from "../../lib/test-provider"

const opencode = path.resolve(import.meta.dir, "../../..")
const prompt = "Fixture prompt"
const resultLine = /NATIVE_OWNER_RESULT (ses_\w+) (\d{3}) (\w+) (ses_\w+|-)\r?\n/

const launch = Effect.fnUntraced(function* (input: {
  readonly home: string
  readonly llmURL: string
  readonly args: readonly string[]
  readonly listener?: { readonly url: string; readonly attachSelection?: string }
}) {
  const directory = yield* Effect.promise(() => realpath(input.home))
  const config = path.join(directory, "tui.json")
  const probe = new URL("../../fixture/native-owner-probe.ts", import.meta.url).href
  const llmOrigin = new URL(input.llmURL).origin
  const temp = path.join(directory, "tmp")
  yield* Effect.promise(() => mkdir(temp, { recursive: true }))
  yield* Effect.promise(() => Bun.write(config, JSON.stringify({
    plugin: [probe],
    keybinds: { session_new: "ctrl+n" },
  })))
  const decoder = new TextDecoder()
  let output = ""
  const child = yield* Effect.acquireRelease(
    Effect.sync(() => Bun.spawn([
      process.execPath,
      "--no-env-file",
      "--no-install",
      `--preload=${path.join(opencode, "test/fixture/native-owner-network.ts")}`,
      "./src/boot.ts",
      ...input.args,
    ], {
      cwd: opencode,
      env: {
        PATH: process.env.PATH,
        HOME: directory,
        PWD: directory,
        TMPDIR: temp,
        XDG_CONFIG_HOME: path.join(directory, "config"),
        XDG_CACHE_HOME: path.join(directory, "cache"),
        XDG_DATA_HOME: path.join(directory, "data"),
        XDG_STATE_HOME: path.join(directory, "state"),
        OPENCODE_TEST_HOME: directory,
        OPENCODE_TEST_MANAGED_CONFIG_DIR: path.join(directory, "managed"),
        OPENCODE_DB: path.join(directory, "opencode.db"),
        OPENCODE_TOOLS_DATA_DIR: path.join(directory, "tools"),
        OPENCODE_PLUGINS_DATA_DIR: path.join(directory, "plugins"),
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          ...testProviderConfig(input.llmURL),
          enabled_providers: ["test"],
          share: "disabled",
          snapshot: false,
        }),
        OPENCODE_TUI_CONFIG: config,
        OPENCODE_AUTH_CONTENT: "{}",
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
        OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        OPENCODE_DISABLE_AUTOCOMPACT: "1",
        OPENCODE_DISABLE_MODELS_FETCH: "1",
        OPENCODE_MODELS_PATH: path.join(opencode, "test/tool/fixtures/models-api.json"),
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: path.join(directory, "bun-cache"),
        npm_config_offline: "true",
        npm_config_registry: llmOrigin,
        BUN_CONFIG_REGISTRY: llmOrigin,
        NATIVE_OWNER_TEST_ORIGINS: input.listener ? `${llmOrigin} ${new URL(input.listener.url).origin}` : llmOrigin,
        NATIVE_OWNER_TEST_ATTACH_SELECTION: input.listener?.attachSelection,
        TERM: "xterm-256color",
      },
      terminal: {
        cols: 120,
        rows: 30,
        data(_, bytes) {
          output += decoder.decode(bytes, { stream: true })
        },
      },
    })),
    (process) => Effect.promise(async () => {
      process.kill("SIGKILL")
      await process.exited
      process.terminal?.close()
    }),
  )

  const terminal = child.terminal
  if (!terminal) return yield* Effect.fail(new Error("test PTY did not open"))
  const waitFor = (pattern: RegExp, since = 0) => pollWithTimeout(Effect.sync(() => {
    const match = pattern.exec(output.slice(since))
    if (match) return { match, end: since + match.index + match[0].length }
    if (child.exitCode !== null || child.signalCode !== null || output.includes("NATIVE_OWNER_PROBE_ERROR")) {
      throw new Error(`CLI stopped before ${pattern}: ${JSON.stringify(output.slice(-3000))}`)
    }
  }), `CLI did not publish ${pattern}`, "30 seconds").pipe(
    Effect.mapError((error) => new Error(`${error.message}: ${JSON.stringify(output.slice(-3000))}`)),
  )

  return {
    waitFor,
    result: (since?: number) => waitFor(resultLine, since).pipe(Effect.map((found) => ({
      sessionID: found.match[1],
      status: Number(found.match[2]),
      preference: found.match[3],
      forkedFrom: found.match[4],
      end: found.end,
    }))),
    submit: (since?: number) => waitFor(/NATIVE_OWNER_HOME_READY\r?\n/, since).pipe(
      Effect.tap(() => Effect.sync(() => terminal.write(`${prompt}\r`))),
    ),
    newSession: () => terminal.write("\x0e"),
  }
})

const seed = Effect.fnUntraced(function* (input: { readonly home: string; readonly llmURL: string }) {
  const serve = yield* launch({ ...input, args: ["serve", "--hostname", "127.0.0.1", "--port", "0"] })
  const address = yield* serve.waitFor(/listening on (http:\/\/127\.0\.0\.1:\d+)/)
  const baseUrl = address.match[1]
  if (!baseUrl) return yield* Effect.fail(new Error("serve omitted its loopback URL"))
  const directory = yield* Effect.promise(() => realpath(input.home))
  const client = createOpencodeClient({ baseUrl, directory })
  const root = yield* Effect.promise(async () => (await client.session.create({
    title: "Saved root",
  }, { throwOnError: true })).data)
  yield* Effect.promise(() => client.session.create({
    title: "Newer child",
    parentID: root.id,
  }, { throwOnError: true }))
  return { baseUrl, client, root: root.id }
})

// These source CLI launches need a real POSIX PTY, as startup-title.test.ts does.
if (process.platform !== "win32") {
  for (const origin of ["--prompt", "the home composer"]) {
    cliIt.live(`lets only the first local root set quota when created from ${origin}`, ({ home, llm }) =>
      Effect.gen(function* () {
        yield* llm.text("first fixture response")
        yield* llm.text("second fixture response")
        const tui = yield* launch({
          home,
          llmURL: llm.url,
          args: [home, "--model", testModelID, ...(origin === "--prompt" ? ["--prompt", prompt] : [])],
        })
        if (origin !== "--prompt") yield* tui.submit()
        const first = yield* tui.result()
        expect(first).toMatchObject({ status: 200, preference: "on" })

        tui.newSession()
        yield* tui.submit(first.end)
        const second = yield* tui.result(first.end)
        expect(second.sessionID).not.toBe(first.sessionID)
        expect(second.status).toBe(503)
      }), 70_000,
    )
  }

  for (const { flag, fork, listen } of [
    { flag: "--continue" },
    { flag: "--continue", fork: true },
    { flag: "--session" },
    { flag: "--session", fork: true },
    { flag: "--continue", listen: true },
  ]) {
    const mode = `${flag}${fork ? " --fork" : ""}${listen ? " with a loopback listener" : ""}`
    cliIt.live(`lets ${mode} set quota on the opened local root`, ({ home, llm }) =>
      Effect.gen(function* () {
        const saved = yield* Effect.scoped(seed({ home, llmURL: llm.url }))
        const selection = flag === "--session" ? [flag, saved.root] : [flag]
        // The seed has exited, so the native worker can take its loopback port.
        const listener = listen ? new URL(saved.baseUrl) : undefined
        const tui = yield* launch({
          home,
          llmURL: llm.url,
          listener: listener && { url: listener.href },
          args: [
            home, "--model", testModelID, ...selection,
            ...(fork ? ["--fork"] : []),
            ...(listener ? ["--hostname", listener.hostname, "--port", listener.port] : []),
          ],
        })
        const result = yield* tui.result()
        if (fork) {
          expect(result.sessionID).not.toBe(saved.root)
          expect(result.forkedFrom).toBe(saved.root)
        }
        if (!fork) expect(result.sessionID).toBe(saved.root)
        expect(result).toMatchObject({ status: 200, preference: "on" })
      }), 70_000,
    )
  }

  for (const entry of ["startup fork", "ordinary session navigation"]) {
    cliIt.live(`keeps standalone serve unbound after attach uses ${entry}`, ({ home, llm }) =>
      Effect.gen(function* () {
        const saved = yield* seed({ home, llmURL: llm.url })
        const put = Effect.promise(() => saved.client.session.cybersecPreservation.update({
          sessionID: saved.root, preference: "on",
        }))
        expect((yield* put).response.status).toBe(503)

        const fork = entry === "startup fork"
        const tui = yield* launch({
          home,
          llmURL: llm.url,
          listener: { url: saved.baseUrl, attachSelection: fork ? undefined : saved.root },
          args: ["attach", saved.baseUrl, "--dir", home, ...(fork ? ["--continue", "--fork"] : [])],
        })
        const result = yield* tui.result()
        if (fork) {
          expect(result.sessionID).not.toBe(saved.root)
          expect(result.forkedFrom).toBe(saved.root)
        }
        if (!fork) expect(result.sessionID).toBe(saved.root)
        expect(result.status).toBe(503)
        expect((yield* put).response.status).toBe(503)
      }), 70_000,
    )
  }
}
