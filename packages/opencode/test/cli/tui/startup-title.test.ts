import { expect } from "bun:test"
import { Database } from "bun:sqlite"
import { Effect } from "effect"
import path from "node:path"
import { cliIt, testModelID } from "../../lib/cli-process"
import { pollWithTimeout } from "../../lib/effect"
import { testProviderConfig } from "../../lib/test-provider"

const prompt = "Say hello"

const launch = Effect.fnUntraced(function* (input: {
  readonly home: string
  readonly llmURL: string
  readonly title: string
  readonly sessionID?: string
}) {
  const terminalConfig = path.join(input.home, "tui.json")
  yield* Effect.promise(() => Bun.write(terminalConfig, JSON.stringify({ keybinds: { session_new: "ctrl+n" } })))

  let output = ""
  const decoder = new TextDecoder()
  const argv = [process.execPath, "run", "src/boot.ts", input.home, "--model", testModelID, "--prompt", prompt]
  if (input.sessionID) argv.push("--session", input.sessionID)
  const child = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.spawn(argv, {
        cwd: path.resolve(import.meta.dir, "../../.."),
        env: {
          ...process.env,
          HOME: input.home,
          PWD: input.home,
          XDG_DATA_HOME: path.join(input.home, "data"),
          XDG_CACHE_HOME: path.join(input.home, "cache"),
          XDG_CONFIG_HOME: path.join(input.home, "config"),
          XDG_STATE_HOME: path.join(input.home, "state"),
          OPENCODE_TEST_HOME: input.home,
          OPENCODE_DB: path.join(input.home, "opencode.db"),
          OPENCODE_CONFIG_CONTENT: JSON.stringify(testProviderConfig(input.llmURL)),
          OPENCODE_TUI_CONFIG: terminalConfig,
          OPENCODE_AUTH_CONTENT: "{}",
          OPENCODE_DISABLE_PROJECT_CONFIG: "1",
          OPENCODE_DISABLE_AUTOUPDATE: "1",
          OPENCODE_DISABLE_MODELS_FETCH: "1",
          OPENCODE_PURE: "1",
          VIBETERM_INITIAL_SESSION_TITLE: input.title,
          TERM: "xterm-256color",
        },
        terminal: {
          cols: 120,
          rows: 30,
          data(_, bytes) {
            output += decoder.decode(bytes, { stream: true })
          },
        },
      }),
    ),
    (child) =>
      Effect.promise(async () => {
        child.kill("SIGKILL")
        await child.exited
        child.terminal?.close()
      }),
  )

  const terminal = child.terminal
  if (!terminal) return yield* Effect.fail(new Error("test PTY did not open"))
  const waitForOutput = (pattern: RegExp, since = 0) =>
    pollWithTimeout(
      Effect.sync(() => {
        if (pattern.test(output.slice(since))) return true
        if (child.exitCode !== null || child.signalCode !== null) return false
      }),
      `TUI did not render ${pattern}`,
      "30 seconds",
    ).pipe(
      Effect.flatMap((found) => (found ? Effect.void : Effect.fail(new Error(`TUI exited before rendering ${pattern}`)))),
      Effect.mapError((error) => new Error(`${error.message}: ${JSON.stringify(output.slice(-3000))}`)),
    )

  return {
    waitForOutput,
    newSession: Effect.gen(function* () {
      const since = output.length
      terminal.write("\x0e")
      yield* waitForOutput(/\x1b\][02];OpenCode[\x07\x1b]/, since)
      terminal.write(`${prompt}\r`)
    }),
  }
})

function created(database: string) {
  using db = new Database(database, { readonly: true })
  return db
    .query<{ id: string; title: string }, []>(
      "select aggregate_id as id, json_extract(data, '$.info.title') as title from event where type = 'session.created.1' order by rowid",
    )
    .all()
}

// Bun's test terminal uses a POSIX PTY.
if (process.platform !== "win32") {
  cliIt.live(
    "only the initial --prompt persists the Vibeterm title at session creation",
    ({ home, llm }) =>
      Effect.gen(function* () {
        const title = "Title supplied by Vibeterm"
        const database = path.join(home, "opencode.db")
        const defaultTitle = expect.stringMatching(/^New session - /)
        const initial = yield* Effect.scoped(
          Effect.gen(function* () {
            yield* llm.text("tui-startup-reply")
            const tui = yield* launch({ home, llmURL: llm.url, title })
            yield* tui.waitForOutput(/tui-startup-reply/)

            const sessions = created(database)
            expect(sessions.map((session) => session.title)).toEqual([title])
            const [initial] = sessions
            using db = new Database(database, { readonly: true })
            expect(db.query<{ title: string }, []>("select title from session").all()).toEqual([{ title }])
            expect(yield* llm.calls).toBe(1)

            yield* llm.text("tui-new-session-reply")
            yield* tui.newSession
            yield* tui.waitForOutput(/tui-new-session-reply/)
            expect(created(database).map((session) => session.title)).toEqual([title, defaultTitle])
            return initial
          }),
        )

        const resumed = yield* launch({ home, llmURL: llm.url, title: "Do not use", sessionID: initial.id })
        yield* resumed.waitForOutput(/OC \| Title supplied by Vibeterm/)
        yield* llm.text("tui-post-resume-reply")
        yield* resumed.newSession
        yield* resumed.waitForOutput(/tui-post-resume-reply/)
        expect(created(database).map((session) => session.title)).toEqual([title, defaultTitle, defaultTitle])
      }),
    90_000,
  )
}
