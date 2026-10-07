export * as InstantPrompt from "."

import fs from "fs"
import os from "os"
import path from "path"
import { GlobalPath } from "@opencode-ai/core/global-path"
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"
import { TuiLayout } from "../layout"
import { InstantCache } from "./cache"
import { InstantConfig } from "./config"
import { InstantSession } from "./session"
import type { Message, Reply } from "./worker"

// The instant startup prompt. `opencode` calls start() before it loads the
// rest of the CLI: the terminal goes into raw mode at once, so keys typed while
// the TUI loads are neither echoed by the tty nor turned into stray Enters,
// and the home screen with an editable prompt is painted from tui.json and the
// startup cache. A worker thread reads and paints keys while the main thread
// loads. Just before its renderer claims the terminal the TUI awaits
// handover(); from then on the renderer feeds keys, pastes and clicks back in
// and paints frame() until the home prompt mounts and claim()s the text,
// caret and selection. Anything else that runs instead (another command, an
// error) calls dismiss() to restore the terminal.
//
// Without the screen (`startup.instant_prompt: false`, or `--mini`) the same
// raw-mode capture runs invisibly when `startup.early_input` is on, and the
// text lands in the prompt once it exists.

declare global {
  const OPENCODE_INSTANT_WORKER_PATH: string
}

export type Handoff = {
  screen: boolean
  text: string
  caret: number
  selection?: { start: number; end: number }
  placeholder: number
  queued?: InstantSession.Queued
  entry?: InstantCache.Directory
  homeBottomRows: number
}

// What the TUI provides once its renderer owns the terminal: a repaint request,
// a way to quit through the renderer's own teardown, and a notice that the
// instant prompt is gone.
export type Host = { render(): void; exit(): void; ended(): void }

type Phase = "worker" | "main" | "gap"

type Session = {
  init: InstantSession.Init
  core: InstantSession.Session
  phase: Phase
  worker?: Worker
  flags: Int32Array
  host?: Host
  backlog: boolean
  timers: { spinner?: ReturnType<typeof setInterval>; escape?: ReturnType<typeof setTimeout> }
  listeners: {
    data: (chunk: Buffer) => void
    resize: () => void
    exit: () => void
    signal: (signal: NodeJS.Signals) => void
  }
}

let session: Session | undefined

const SIGNALS = ["SIGTERM", "SIGHUP", "SIGINT"] as const

const VALUE_FLAGS = new Set([
  "-m",
  "--model",
  "-s",
  "--session",
  "--prompt",
  "--agent",
  "--port",
  "--hostname",
  "--log-level",
  "--mdns-domain",
  "--cors",
  "--replay-limit",
])
const SKIP_FLAGS = new Set(["-h", "--help", "-v", "--version", "--print-logs", "--fork", "--prompt"])

// Which kind of startup this command line is, without yargs: the home screen
// (optionally with a project directory), an existing session (-s ID or -c),
// the minimal TUI, or anything else.
export function classify(argv: string[], cwd = process.env.PWD ?? process.cwd()) {
  const positionals: string[] = []
  let mini = false
  let resume = false
  let sessionID: string | undefined
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === "--") return
    const [flag, inline] = arg.split("=", 2)
    if (SKIP_FLAGS.has(flag)) return
    if (flag === "--mini") mini = true
    if (flag === "-c" || flag === "--continue") resume = true
    if (flag === "-s" || flag === "--session") {
      resume = true
      sessionID = inline ?? argv[index + 1]
    }
    if (VALUE_FLAGS.has(flag) && inline === undefined) index++
    if (!arg.startsWith("-")) positionals.push(arg)
  }
  if (positionals.length > 1) return
  const project = positionals[0] ? path.resolve(cwd, positionals[0]) : process.cwd()
  try {
    if (!fs.statSync(project).isDirectory()) return
    const mode = mini ? ("mini" as const) : resume ? ("session" as const) : ("tui" as const)
    return { mode, sessionID, directory: fs.realpathSync(project) }
  } catch {
    return
  }
}

// The TUI's kv.json in the state directory, a plain JSON file it writes on
// every change; the sidebar settings come from there.
function readKv(): Record<string, unknown> {
  try {
    const kv = JSON.parse(fs.readFileSync(path.join(GlobalPath.paths.state, "kv.json"), "utf8"))
    return kv && typeof kv === "object" ? kv : {}
  } catch {
    return {}
  }
}

const write = (text: string) => {
  try {
    fs.writeSync(1, text)
  } catch {}
}

const size = () => ({ width: process.stdout.columns || 80, height: process.stdout.rows || 24 })

function workerPath() {
  if (typeof OPENCODE_INSTANT_WORKER_PATH !== "undefined") return OPENCODE_INSTANT_WORKER_PATH
  return new URL("./worker.ts", import.meta.url).href
}

export function start(argv = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env) {
  if (session || process.platform === "win32") return
  if (!process.stdin.isTTY || !process.stdout.isTTY || env.TERM === "dumb") return
  const kind = classify(argv)
  if (!kind) return
  const config = InstantConfig.read(env)
  const screen = kind.mode !== "mini" && config.instantPrompt
  if (!screen && !config.earlyInput) return

  const cache = screen ? InstantCache.read() : undefined
  const kv = kind.mode === "session" ? readKv() : {}
  const init: InstantSession.Init = {
    screen,
    config,
    cache,
    entry: cache?.directories[kind.directory],
    session:
      kind.mode === "session"
        ? {
            id: kind.sessionID,
            entry: kind.sessionID ? cache?.sessions?.[kind.sessionID] : undefined,
            sidebar: kv.sidebar === "hide" ? "hide" : "auto",
            idLine: TuiLayout.sidebarShowsSessionId({
              kv: kv.sidebar_session_id,
              configured: config.sidebarSessionId,
              channel: InstallationChannel,
            }),
          }
        : undefined,
    cwd: kind.directory,
    home: GlobalPath.paths.home,
    version: InstallationVersion,
    placeholder: Math.floor(Math.random() * TuiLayout.HomePlaceholders.normal.length),
  }
  const self: Session = {
    init,
    core: InstantSession.create(init),
    phase: "worker",
    flags: new Int32Array(new SharedArrayBuffer(8)),
    backlog: true,
    timers: {},
    listeners: {
      data: (chunk) => read(self, chunk),
      resize: () => resize(self),
      exit: () => restore(self),
      // The terminal may already be gone (a closed pane sends SIGHUP), so
      // restoring it can fail; the process still exits as the signal asks.
      signal: (signal) => {
        try {
          restore(self)
        } finally {
          process.exit(128 + (os.constants.signals[signal] ?? 1))
        }
      },
    },
  }
  session = self

  process.stdin.setRawMode(true)
  process.on("exit", self.listeners.exit)
  for (const signal of SIGNALS) process.on(signal, self.listeners.signal)
  process.stdout.on("resize", self.listeners.resize)
  if (screen) write(InstantSession.enter(init) + self.core.paint(size().width, size().height))

  try {
    const worker = new Worker(workerPath())
    worker.onmessage = (event: MessageEvent<Reply>) => {
      if (event.data.type === "quit") quit(self)
    }
    worker.onerror = () => fallback(self)
    worker.postMessage({
      type: "init",
      init,
      size: size(),
      flags: self.flags.buffer as SharedArrayBuffer,
    } satisfies Message)
    self.worker = worker
  } catch {
    fallback(self)
  }
}

// Without a worker the main thread reads keys itself, between the chunks of
// the CLI it is loading.
function fallback(self: Session) {
  if (self.phase !== "worker") return
  stopWorker(self)
  self.phase = "main"
  process.stdin.on("data", self.listeners.data)
  process.stdin.resume()
  if (self.init.screen) self.timers.spinner = setInterval(() => write(self.core.tick()), TuiLayout.Spinner.interval)
}

// Stops the worker's writes at once: whatever it was painting either finished
// before this returns or never reaches the terminal.
function silence(self: Session) {
  // A worker terminated mid-write never releases the lock; waiting is bounded.
  const until = Date.now() + 100
  while (Atomics.compareExchange(self.flags, 0, 0, 1) !== 0 && Date.now() < until) {}
  Atomics.store(self.flags, 1, 1)
  Atomics.store(self.flags, 0, 0)
}

function stopWorker(self: Session) {
  silence(self)
  self.worker?.terminate()
  self.worker = undefined
}

function resize(self: Session) {
  if (self.phase === "worker") return self.worker?.postMessage({ type: "resize", size: size() } satisfies Message)
  if (self.phase === "main" && self.init.screen) write(self.core.paint(size().width, size().height))
}

function paint(self: Session) {
  if (!self.init.screen) return
  if (self.host) return self.host.render()
  if (self.phase === "main") write(self.core.paint(size().width, size().height))
}

function read(self: Session, chunk: Buffer) {
  const backlog = self.backlog
  self.backlog = false
  clearTimeout(self.timers.escape)
  if (self.core.input(chunk, backlog) === "quit") return quit(self)
  if (self.core.escapePending())
    self.timers.escape = setTimeout(() => {
      if (self.core.flushEscape() === "quit") return quit(self)
      paint(self)
    }, 30)
  paint(self)
}

function end(self: Session) {
  if (session === self) session = undefined
  clearInterval(self.timers.spinner)
  clearTimeout(self.timers.escape)
  stopWorker(self)
  process.stdin.off("data", self.listeners.data)
  process.stdout.off("resize", self.listeners.resize)
  process.off("exit", self.listeners.exit)
  for (const signal of SIGNALS) process.off(signal, self.listeners.signal)
  self.host?.ended()
}

// Gives the terminal back to the shell: the state the TUI never took over.
function restore(self: Session) {
  const owned = self.phase !== "gap"
  end(self)
  if (!owned) return
  if (self.init.screen) write(InstantSession.leave())
  try {
    process.stdin.setRawMode(false)
  } catch {}
  process.stdin.pause()
}

function quit(self: Session) {
  if (self.host) return self.host.exit()
  restore(self)
  process.exit(0)
}

export function active() {
  return !!session
}

// How long the TUI waits, once loaded, for a prompt to claim the instant
// prompt before dropping it: a session's prompt mounts only after the
// session has loaded.
export function claimGrace() {
  return session?.init.session ? 10_000 : 1_000
}

export function textColor() {
  return session?.init.cache?.theme?.text
}

// Whether the TUI should keep painting the instant screen until its home
// prompt takes over.
export function screen() {
  return !!session?.init.screen
}

// Called just before the TUI's renderer claims the terminal. The worker stops
// and hands back the prompt's state with the bytes it has read but not yet
// turned into keys, which go back to the front of stdin so the renderer sees
// them first; the screen's own keyboard modes are switched off so the
// renderer's push and pop of them stay balanced. Editing continues through
// feed(), paste() and mouse() until claim().
export async function handover() {
  const self = session
  if (!self || self.phase === "gap") return
  const pending = self.phase === "worker" ? await fromWorker(self) : self.core.takePending()
  if (session !== self) return
  clearTimeout(self.timers.escape)
  process.stdin.off("data", self.listeners.data)
  self.phase = "gap"
  if (pending) process.stdin.unshift(Buffer.from(pending, "latin1"))
  if (!self.init.screen) return
  write(InstantSession.modesOff())
  clearInterval(self.timers.spinner)
  self.timers.spinner = setInterval(() => {
    self.core.tick()
    self.host?.render()
  }, TuiLayout.Spinner.interval)
}

function fromWorker(self: Session) {
  const worker = self.worker
  if (!worker) return Promise.resolve("")
  silence(self)
  return new Promise<string>((resolve) => {
    const timeout = setTimeout(() => finish(""), 1000)
    function finish(pending: string) {
      clearTimeout(timeout)
      stopWorker(self)
      resolve(pending)
    }
    worker.onmessage = (event: MessageEvent<Reply>) => {
      if (event.data.type === "quit") {
        finish("")
        return quit(self)
      }
      self.core = InstantSession.create(self.init, event.data.state)
      finish(event.data.pending)
    }
    worker.onerror = () => finish("")
    worker.postMessage({ type: "stop" } satisfies Message)
  })
}

export function attach(host: Host) {
  if (session) session.host = host
}

// A renderer input handler: every key sequence goes to the instant editor
// while it is active, and nothing reaches the TUI's keymap.
export function feed(sequence: string) {
  const self = session
  if (!self || self.phase !== "gap") return false
  if (self.core.input(Buffer.from(sequence)) === "quit") {
    quit(self)
    return true
  }
  if (self.core.escapePending() && self.core.flushEscape() === "quit") quit(self)
  paint(self)
  return true
}

export function paste(text: string) {
  const self = session
  if (!self || self.phase !== "gap") return false
  self.core.paste(text)
  paint(self)
  return true
}

export function mouse(event: InstantSession.Mouse) {
  const self = session
  if (!self || self.phase !== "gap") return
  self.core.pointer(event)
  paint(self)
}

// The frame for a renderer of this size, for the TUI to draw while it loads.
export function frame(width: number, height: number) {
  const self = session
  if (!self?.init.screen) return
  return self.core.compute(width, height)
}

// The typed state, once, for the prompt that takes over; ends the session.
export function claim(): Handoff | undefined {
  const self = session
  if (!self) return
  if (self.phase !== "gap") {
    restore(self)
    return
  }
  end(self)
  const state = self.core.state()
  return {
    screen: self.init.screen,
    text: state.text,
    caret: state.caret,
    selection: self.core.editor.selection(),
    placeholder: self.init.placeholder,
    queued: state.queued,
    entry: self.init.entry,
    homeBottomRows: self.init.entry?.homeBottomRows ?? TuiLayout.defaultHomeBottomRows,
  }
}

// Restores the terminal for anything other than the TUI that runs instead:
// another command, help output or a startup error.
export function dismiss() {
  if (session) restore(session)
}
