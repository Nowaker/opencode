import assert from "node:assert/strict"
import { mkdirSync, readFileSync, statSync, unwatchFile, watchFile, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import stripAnsi from "strip-ansi"

const tools = process.env.OPENCODE_TOOLS_ROOT
assert(tools, "set OPENCODE_TOOLS_ROOT to the opencode-tools checkout")
const { attachTestClient, disposeTestRigs, runTestTmux, testScratchDir, testSocketName, waitForTestState } =
  await import(join(tools, "vibeterm-opencode-client/tmux-test-utils.ts"))
const root = testScratchDir("unfocused-redraw")
const socket = testSocketName("unfocused-redraw")
const packageRoot = resolve(import.meta.dir, "..")
const repo = resolve(packageRoot, "../..")
const endpoint = join(root, "endpoint")
const output = join(root, "pane.bin")
const config = join(root, "config/opencode")
for (const path of [config, join(root, "home"), join(root, "project")]) mkdirSync(path, { recursive: true })
writeFileSync(output, "")
writeFileSync(join(config, "opencode.json"), JSON.stringify({ autoupdate: false }))
writeFileSync(
  join(config, "tui.json"),
  JSON.stringify({ plugin: [pathToFileURL(join(packageRoot, "test/fixture/redraw.ts")).href] }),
)
const environment = {
  HOME: join(root, "home"),
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  TERM: "xterm-256color",
  LANG: "en_US.UTF-8",
  XDG_CONFIG_HOME: join(root, "config"),
  XDG_DATA_HOME: join(root, "data"),
  XDG_CACHE_HOME: join(root, "cache"),
  XDG_STATE_HOME: join(root, "state"),
  OPENCODE_TOOLS_DATA_DIR: join(root, "tools"),
  OPENCODE_PLUGINS_DATA_DIR: join(root, "plugins"),
  OPENCODE_DISABLE_PROJECT_CONFIG: "1",
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
  OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
  OPENCODE_DISABLE_MODELS_FETCH: "1",
  OPENCODE_REDRAW_ENDPOINT: endpoint,
  OPENCODE_REDRAW_BASELINE_FOCUS: process.env.OPENCODE_REDRAW_BASELINE_FOCUS ?? "",
  VIBETERM_SETTINGS: join(root, "settings.yaml"),
}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
let client: ReturnType<typeof attachTestClient> | undefined
let paneId = ""
try {
  runTestTmux(socket, ["-f", "/dev/null", "new-session", "-d", "-s", "probe", "-n", "hold", "sleep 300"])
  runTestTmux(socket, ["set-option", "-g", "focus-events", "on"])
  runTestTmux(socket, ["set-option", "-as", "terminal-features", ",xterm*:focus"])
  for (const [key, value] of Object.entries(environment)) runTestTmux(socket, ["set-environment", "-g", key, value])
  for (const key of [
    "OPENCODE_CONFIG",
    "OPENCODE_CONFIG_CONTENT",
    "OPENCODE_CONFIG_DIR",
    "OPENCODE_TUI_CONFIG",
    "VIBETERM_TMUX_EXPECTED_PID",
    "VIBETERM_TMUX_EXPECTED_PATH",
    "OPENCODE_PURE",
  ]) {
    runTestTmux(socket, ["set-environment", "-gu", key])
  }
  client = attachTestClient(socket, "probe", { width: 140, height: 40 })
  await waitForTestState(() => runTestTmux(socket, ["list-clients"]).length > 0, "attached terminal")
  const executable = process.env.OPENCODE_REDRAW_BINARY
  const command = executable
    ? `exec ${quote(executable)}`
    : `exec ${quote(process.execPath)} --conditions=browser --preload ${quote(join(packageRoot, "node_modules/@opentui/solid/scripts/preload.js"))} ${quote(join(repo, "packages/opencode/src/boot.ts"))}`
  const [window, pane] = runTestTmux(socket, [
    "new-window",
    "-d",
    "-P",
    "-F",
    "#{window_id}\t#{pane_id}",
    "-t",
    "probe:",
    "-c",
    join(root, "project"),
    command,
  ]).split("\t")
  assert(window && pane)
  paneId = pane
  runTestTmux(socket, ["pipe-pane", "-t", pane, `cat >> ${quote(output)}`])
  runTestTmux(socket, ["select-window", "-t", window])
  await waitForTestState(
    () => readFileSync(output, "utf8").includes("REDRAW_READY"),
    "real opencode redraw fixture",
    120_000,
  )
  client.write("\x1b[I")
  assert(readFileSync(output, "utf8").includes("\x1b[?1004h"), "OpenTUI must enable terminal focus reporting")
  runTestTmux(socket, ["select-window", "-t", "probe:hold"])
  await waitForTestState(() => readFileSync(`${endpoint}.focus`, "utf8") === "false", "initial terminal blur", 10_000)
  const url = new URL(`http://127.0.0.1:${readFileSync(endpoint, "utf8")}`)
  const state = async () => (await fetch(new URL("/state", url))).json()
  const focus = async (value: boolean) => {
    runTestTmux(socket, ["select-window", "-t", value ? window : "probe:hold"])
    await waitForTestState(
      () => readFileSync(`${endpoint}.focus`, "utf8") === String(value),
      `terminal focus=${value}`,
      10_000,
    )
    await fetch(new URL("/content", url), { method: "POST", body: `FOCUS_${value}_${Date.now()}` })
  }
  const sample = async () => {
    const start = statSync(output).size
    const time = performance.now()
    await new Promise((resolve) => setTimeout(resolve, 3200))
    const elapsed = performance.now() - time
    const bytes = readFileSync(output).subarray(start)
    return {
      bytes: bytes.length,
      seconds: elapsed / 1000,
      bytesPerSecond: (bytes.length * 1000) / elapsed,
      frames: bytes.toString().split("\x1b[?2026l").length - 1,
    }
  }
  const measure = async () => {
    await focus(true)
    const focused = await sample()
    await focus(false)
    const unfocused = await sample()
    const marker = "!#$%&()*+,-./:;<=>?@[]^`{|}~"
    const contentStart = statSync(output).size
    const arrived = new Promise<number>((resolve, reject) => {
      const changed = () => {
        if (!stripAnsi(readFileSync(output).subarray(contentStart).toString()).includes(marker)) return
        clearTimeout(timeout)
        unwatchFile(output, changed)
        resolve(performance.timeOrigin + performance.now())
      }
      watchFile(output, { interval: 1 }, changed)
      const timeout = setTimeout(() => {
        unwatchFile(output, changed)
        reject(new Error("content did not render"))
      }, 2000)
    })
    const response = await fetch(new URL("/content", url), { method: "POST", body: marker })
    const { changedAt } = await response.json()
    const contentLatencyMs = (await arrived) - changedAt
    await focus(true)
    const restored = await sample()
    return { focused, unfocused, restored, contentLatencyMs }
  }
  const spinner = await measure()
  await fetch(new URL("/live", url), { method: "POST" })
  const live = await measure()
  const result = {
    spinner,
    live,
    frameBudgetMs: 1000 / (await state()).maxFps,
    focusEvents: "on",
    source: executable ?? repo,
  }
  console.log(JSON.stringify(result, null, 2))
  const destination = process.argv[2]
  if (destination) writeFileSync(destination, JSON.stringify(result, null, 2) + "\n")
  if (process.env.OPENCODE_REDRAW_EXPECT_THROTTLE === "1") {
    for (const measurement of [spinner, live]) {
      assert(
        measurement.unfocused.bytesPerSecond < measurement.focused.bytesPerSecond / 5,
        "unfocused writes must fall by at least 80%",
      )
      assert(measurement.unfocused.frames <= 4, "unfocused animation must stay near one frame per second")
      assert(
        measurement.restored.bytesPerSecond > measurement.focused.bytesPerSecond / 2,
        "focus-in must restore the normal rate",
      )
      assert(measurement.contentLatencyMs < result.frameBudgetMs, "content must arrive within one normal frame")
    }
  }
} catch (error) {
  console.error(JSON.stringify(readFileSync(output, "utf8").slice(0, 6000)))
  console.error("last output", JSON.stringify(readFileSync(output, "utf8").slice(-3000)))
  console.error("screen", runTestTmux(socket, ["capture-pane", "-p", "-t", paneId]))
  console.error("focus-events", runTestTmux(socket, ["show-option", "-gv", "focus-events"]))
  throw error
} finally {
  client?.stop()
  disposeTestRigs()
}
