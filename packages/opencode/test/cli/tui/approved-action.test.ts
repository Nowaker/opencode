import { expect } from "bun:test"
import { Database } from "bun:sqlite"
import { Effect } from "effect"
import { strict } from "node:assert"
import { mkdir, realpath } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { stripVTControlCharacters } from "node:util"
import { actionID, activePreview, exitCode, idlePreview, receiptOutput } from "../../fixture/approved-action-probe"
import { cliIt, testModelID } from "../../lib/cli-process"
import { awaitWithTimeout, pollWithTimeout } from "../../lib/effect"
import { testProviderConfig } from "../../lib/test-provider"

const opencode = path.resolve(import.meta.dir, "../../..")
const plugin = new URL("../../fixture/approved-action-probe.ts", import.meta.url).href
const title = "Approved action fixture"
const humanPrompt = "Continue with the benign fixture"
const receiptReply = "Fixture continuation received"

const launch = Effect.fnUntraced(function* (input: {
  readonly directory: string
  readonly llmURL: string
  readonly mode: "owner" | "unsupported"
}) {
  const directory = input.directory
  const probe = path.join(directory, input.mode)
  const llmOrigin = new URL(input.llmURL).origin
  // The TUI takes a project argument; debug config uses its actual cwd and needs the preload explicitly.
  const args = input.mode === "owner"
    ? ["./src/boot.ts", directory, "--model", testModelID, "--prompt", "Open the approved action fixture"]
    : [
        `--preload=${fileURLToPath(import.meta.resolve("@opentui/solid/preload"))}`,
        path.join(opencode, "src/boot.ts"),
        "debug",
        "config",
      ]
  const decoder = new TextDecoder()
  let output = ""
  const child = yield* Effect.acquireRelease(
    Effect.sync(() => Bun.spawn([
      process.execPath,
      "--no-env-file",
      "--no-install",
      `--preload=${path.join(opencode, "test/fixture/native-owner-network.ts")}`,
      ...args,
    ], {
      cwd: input.mode === "owner" ? opencode : directory,
      env: {
        PATH: process.env.PATH,
        HOME: directory,
        PWD: directory,
        TMPDIR: path.join(directory, "tmp"),
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
          plugin: [plugin],
          share: "disabled",
          snapshot: false,
        }),
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
        NATIVE_OWNER_TEST_ORIGINS: llmOrigin,
        APPROVED_ACTION_TEST_PROBE: probe,
        VIBETERM_INITIAL_SESSION_TITLE: title,
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

  const waitForOutput = (text: string, rendered = false) =>
    pollWithTimeout(
      Effect.sync(() => {
        if ((rendered ? stripVTControlCharacters(output) : output).includes(text)) return true
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`CLI exited before displaying ${text}: ${JSON.stringify(output.slice(-3000))}`)
        }
      }),
      `TUI did not display ${text}`,
      "30 seconds",
    ).pipe(Effect.mapError((error) => new Error(`${error.message}: ${JSON.stringify(output.slice(-3000))}`)))
  return {
    exited: Effect.promise(() => child.exited),
    displayed: waitForOutput(`OC | ${title}`),
    rendered: (text: string) => waitForOutput(text, true),
    submit: (text: string) => Effect.sync(() => {
      strict.ok(child.terminal, "CLI did not open a test PTY")
      child.terminal.write(`${text}\r`)
    }),
    publication: (stage: "plugin" | "running" | "admitted") => pollWithTimeout(
      Effect.promise(async () => {
        const failure = Bun.file(`${probe}.error`)
        if (await failure.exists()) throw new Error(`Approved-action probe: ${await failure.text()}`)
        const file = Bun.file(`${probe}.${stage}`)
        const text = await file.exists() ? await file.text() : ""
        if (text.endsWith("\n")) return text.trimEnd()
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`CLI exited before ${stage}: ${JSON.stringify(output.slice(-3000))}`)
        }
      }),
      `CLI did not publish ${stage}`,
      "30 seconds",
    ).pipe(Effect.mapError((error) => new Error(`${error.message}: ${JSON.stringify(output.slice(-3000))}`))),
  }
})

function receipts(database: string, messageID: string) {
  using db = new Database(database, { readonly: true })
  return db.query<{
    readonly sessionID: string
    readonly messageID: string
    readonly role: string
    readonly partType: string | null
    readonly ignored: number
    readonly synthetic: number
    readonly actionID: string | null
    readonly text: string | null
  }, [string, string]>(`
    select message.session_id as sessionID, message.id as messageID,
           json_extract(message.data, '$.role') as role,
           json_extract(part.data, '$.type') as partType,
           coalesce(json_extract(part.data, '$.ignored'), 0) as ignored,
           coalesce(json_extract(part.data, '$.synthetic'), 0) as synthetic,
           json_extract(part.data, '$.metadata.vibetermApprovedAction.actionID') as actionID,
           json_extract(part.data, '$.text') as text
    from message left join part on part.message_id = message.id
    where message.id = ?1 or json_extract(part.data, '$.metadata.vibetermApprovedAction.actionID') = ?2
  `).all(messageID, actionID)
}

if (process.platform !== "win32") {
  cliIt.live(
    "keeps one approved action running as the displayed portless owner accepts a human prompt",
    ({ home, llm }) => Effect.gen(function* () {
      const directory = yield* Effect.promise(() => realpath(home))
      const gate = path.join(directory, "gate")
      const database = path.join(directory, "opencode.db")
      yield* Effect.promise(() => Promise.all([mkdir(gate), mkdir(path.join(directory, "tmp"))]))
      yield* Effect.promise(() => Promise.all(["active", "finish"].map((name) =>
        Bun.write(path.join(gate, name), "hold\n"),
      )))

      yield* Effect.scoped(Effect.gen(function* () {
        const unsupported = yield* launch({ directory, llmURL: llm.url, mode: "unsupported" })
        expect(yield* unsupported.publication("plugin")).toBe("absent")
        expect(yield* awaitWithTimeout(unsupported.exited, "debug config did not exit", "30 seconds")).toBe(0)
      }))
      expect(yield* llm.calls).toBe(0)

      // Let the first prompt finish only after the root is displayed and the
      // configured server plugin has registered its in-process event hook.
      const firstReply = Promise.withResolvers<void>()
      const humanReply = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(() => {
        firstReply.resolve()
        humanReply.resolve()
      }))
      yield* llm.hold("initial fixture reply", firstReply.promise)
      yield* llm.hold("human fixture reply", humanReply.promise)
      yield* llm.text(receiptReply)
      const tui = yield* launch({ directory, llmURL: llm.url, mode: "owner" })
      expect(yield* tui.publication("plugin")).toBe("version:1")
      yield* tui.displayed
      firstReply.resolve()

      const sessionID = yield* tui.publication("admitted")
      expect(sessionID).toMatch(/^ses_[A-Za-z0-9]+$/)
      const messageID = yield* tui.publication("running")
      expect(messageID).toMatch(/^msg_[A-Za-z0-9]+$/)
      yield* tui.rendered(idlePreview)
      expect(yield* llm.calls).toBe(1)
      yield* tui.submit(humanPrompt)
      yield* awaitWithTimeout(llm.wait(2), "human prompt was blocked by the running action", "30 seconds")
      const humanRequest = JSON.stringify((yield* llm.inputs)[1]?.messages)
      expect(humanRequest).toContain(humanPrompt)
      expect(humanRequest).not.toContain(actionID)

      yield* Effect.promise(() => Bun.write(path.join(gate, "active"), "continue streaming\n"))
      yield* tui.rendered(activePreview)
      expect(receipts(database, messageID)).toEqual([])
      yield* Effect.promise(() => Bun.write(path.join(gate, "finish"), "settle\n"))
      const result = yield* pollWithTimeout(Effect.sync(() => {
        const rows = receipts(database, messageID)
        return rows.length === 0 ? undefined : rows
      }), "approved action receipt did not persist during the held model step", "30 seconds")
      expect(result).toEqual([{
        sessionID,
        messageID,
        role: "user",
        partType: "text",
        ignored: 0,
        synthetic: 0,
        actionID,
        text: expect.any(String),
      }])
      const outcome = result[0]?.text?.split("\n").find((line) => line.startsWith("{"))
      strict.ok(outcome, "receipt is missing its JSON outcome")
      expect(JSON.parse(outcome)).toEqual({ kind: "exited", exitCode, output: receiptOutput })

      expect(yield* llm.calls).toBe(2)
      humanReply.resolve()
      yield* awaitWithTimeout(llm.wait(3), "continuation did not pick up the stored receipt", "30 seconds")
      const continuation = JSON.stringify((yield* llm.inputs)[2]?.messages)
      expect(continuation).toContain(actionID)
      expect(continuation).toContain("literal result")
      yield* tui.rendered(receiptReply)
      expect(yield* llm.calls).toBe(3)
      expect(yield* tui.publication("running")).toBe(messageID)
    }),
    180_000,
  )
}
