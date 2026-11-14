export * as StartupInput from "./index"

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Worker } from "node:worker_threads"
import { stringWidth } from "#string-width"
import { StartupEditor } from "./editor"
import { StartupFrame } from "./frame"
import type { Init, Reply, Request } from "./protocol"
import { StartupTerminal } from "./terminal"

// The default TUI's early terminal owner. The CLI calls start() before it imports anything heavy: the terminal goes
// into raw mode at once, so keys typed while OpenCode loads are neither echoed nor lost, and a worker thread paints
// an editable fullscreen composer while the main thread evaluates the rest of the CLI.
//
// Ownership passes in one direction. Until handover() resolves, this handle owns the terminal: raw mode, the
// alternate screen, the worker and its listeners. handover() asks the worker to stop at a complete input token; it
// answers with the draft and every byte it read but did not apply. The receiver builds its renderer and calls
// adopted(); from then on the renderer owns the terminal and close() releases only this handle's listeners. Before
// adoption, close() restores the terminal, so a startup that fails anywhere in between does not strand it.

export type Snapshot = StartupEditor.Snapshot
export type Route = StartupFrame.Route

export type Transfer = {
  readonly snapshot: Snapshot
  /** Raw bytes the worker read after its cutoff, in arrival order; they precede anything still in the kernel. */
  readonly bytes: Uint8Array
  /** The renderer now owns the terminal. */
  readonly adopted: () => void
}

export type Handle = {
  readonly route: Route
  /** Shows a status line under the startup composer until the renderer takes over. */
  readonly status: (text?: string) => void
  /** Resolves once the worker has stopped at a token boundary, or undefined when the early owner fell back. */
  readonly handover: () => Promise<Transfer | undefined>
  readonly close: () => void
}

type Phase = "capturing" | "transferring" | "transferred" | "adopted" | "inert" | "closed"

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const

// The default command's syntax (packages/cli/src/commands/commands.ts). Anything else, including help, version and
// unknown flags, starts without an early owner.
const BOOLEAN_FLAGS = new Set(["--standalone", "--auto", "--yolo", "--dangerously-skip-permissions", "--print-logs"])
const VALUE_FLAGS = new Set(["--server", "-s", "--session", "--prompt"])
const COMMANDS = new Set([
  "upgrade",
  "update",
  "uninstall",
  "acp",
  "api",
  "debug",
  "auth",
  "mcp",
  "plugin",
  "models",
  "stats",
  "mini",
  "run",
  "session",
  "service",
  "reload",
  "pair",
  "serve",
])

export function classify(argv: readonly string[], cwd: string) {
  const values = new Map<string, string>()
  const positionals: string[] = []
  let resume = false
  const queue = [...argv]
  for (let arg = queue.shift(); arg !== undefined; arg = queue.shift()) {
    if (!arg.startsWith("-") || arg === "-") {
      positionals.push(arg)
      continue
    }
    const equals = arg.indexOf("=")
    const flag = arg.startsWith("--") && equals > 0 ? arg.slice(0, equals) : arg
    if (BOOLEAN_FLAGS.has(flag) && flag === arg) continue
    if ((flag === "-c" || flag === "--continue") && flag === arg) {
      resume = true
      continue
    }
    if (!VALUE_FLAGS.has(flag)) return
    const value = flag === arg ? queue.shift() : arg.slice(equals + 1)
    const name = flag === "-s" ? "--session" : flag
    if (value === undefined || values.has(name)) return
    values.set(name, value)
  }
  if (positionals.length > 1) return
  const directory = positionals[0]
  if (directory !== undefined) {
    if (COMMANDS.has(directory)) return
    if (!fs.statSync(path.resolve(cwd, directory), { throwIfNoEntry: false })?.isDirectory()) return
  }
  const route: Route = resume || values.has("--session") ? "session" : "home"
  return { route, prompt: values.get("--prompt") }
}

export function start(input: {
  readonly argv: readonly string[]
  readonly env: NodeJS.ProcessEnv
  readonly worker: URL
  readonly version?: string
}): Handle | undefined {
  if (process.platform === "win32") return
  if (!process.stdin.isTTY || !process.stdout.isTTY) return
  if (input.env.TERM === "dumb" || input.env.OPENCODE_SSH_ASKPASS_PORT) return
  if (input.env.OPENCODE_STORY || input.env.OPENCODE_ROUTE || input.env.OPENCODE_DRIVE) return
  const kind = classify(input.argv, process.cwd())
  if (!kind) return

  const size = () => ({ width: process.stdout.columns || 80, height: process.stdout.rows || 24 })
  // [0] guards terminal writes, [1] tells the worker the terminal is no longer its to write.
  const flags = new Int32Array(new SharedArrayBuffer(8))
  const init: Init = { route: kind.route, prompt: kind.prompt, ...size(), version: input.version, flags }
  let phase: Phase = "capturing"
  let ready = false
  let failure: Error | undefined
  const waiting = Promise.withResolvers<Transfer | undefined>()
  waiting.promise.catch(() => {})
  let requested = false

  const post = (request: Request) => worker.postMessage(request)
  const resize = () => post({ type: "resize", ...size() })
  const exit = () => restore()
  const signal = (name: NodeJS.Signals) => {
    restore()
    // With no other handler the signal's default action was to end the process; keep it.
    if (process.listenerCount(name) === 0) process.exit(128 + (os.constants.signals[name] ?? 1))
  }

  const release = () => {
    process.stdout.off("resize", resize)
    process.off("exit", exit)
    SIGNALS.forEach((name) => process.off(name, signal))
  }

  const silence = () => {
    const until = Date.now() + 200
    while (Atomics.compareExchange(flags, 0, 0, 1) !== 0 && Date.now() < until) Atomics.wait(flags, 0, 1, 5)
    Atomics.store(flags, 1, 1)
    Atomics.store(flags, 0, 0)
    Atomics.notify(flags, 0)
  }

  // Gives the terminal back to the shell. Only the owner restores it: once a renderer adopted it, it is not ours.
  function restore() {
    if (phase === "closed" || phase === "adopted" || phase === "inert") return
    phase = "closed"
    release()
    silence()
    void worker.terminate()
    StartupTerminal.release()
  }

  function fallBack() {
    if (phase === "closed" || phase === "inert") return
    restore()
    phase = "inert"
    if (requested) waiting.resolve(undefined)
  }

  // A worker that cannot read the terminal says so and the TUI starts without it. Any other worker failure is a
  // startup failure: once it has read input, the draft it held is gone, which must not look like an empty draft.
  function fail(error: Error) {
    if (phase === "closed" || phase === "adopted" || phase === "inert") return
    restore()
    failure = new Error(
      ready
        ? `Startup input failed: ${error.message}. Text typed while OpenCode loaded is unavailable.`
        : `Startup input could not start: ${error.message}`,
      { cause: error },
    )
    waiting.reject(failure)
  }

  try {
    StartupTerminal.acquire(
      StartupFrame.render({
        route: init.route,
        width: init.width,
        height: init.height,
        text: init.prompt ?? "",
        caret: init.prompt?.length ?? 0,
        anchor: init.prompt?.length ?? 0,
        version: init.version,
        measure: stringWidth,
      }),
    )
  } catch (error) {
    // A terminal that went away before it could be taken starts the TUI without an early owner.
    if (StartupTerminal.gone(error)) return
    throw error
  }
  const worker = (() => {
    try {
      return new Worker(input.worker, { workerData: init })
    } catch (error) {
      StartupTerminal.release()
      throw error
    }
  })()
  worker.on("message", (reply: Reply) => {
    if (reply.type === "ready") {
      ready = true
      return
    }
    if (reply.type === "unavailable") return fallBack()
    if (reply.type === "quit") {
      restore()
      process.exit(130)
    }
    if (reply.type !== "handover" || phase !== "transferring") return
    phase = "transferred"
    Atomics.store(flags, 1, 1)
    void worker.terminate()
    waiting.resolve({
      snapshot: reply.snapshot,
      bytes: reply.bytes,
      adopted: () => {
        if (phase !== "transferred") return
        phase = "adopted"
        release()
      },
    })
  })
  worker.on("error", fail)
  // A worker that ends on its own posted why first; let that message land before treating the exit as a failure.
  worker.on("exit", (code) =>
    setImmediate(() => {
      if (phase === "capturing" || phase === "transferring") fail(new Error(`worker exited with code ${code}`))
    }),
  )
  process.stdout.on("resize", resize)
  process.on("exit", exit)
  SIGNALS.forEach((name) => process.on(name, signal))

  return {
    route: kind.route,
    status: (text) => {
      if (phase === "capturing") post({ type: "status", text })
    },
    handover: () => {
      if (!requested) {
        requested = true
        if (phase === "inert") waiting.resolve(undefined)
        if (failure) waiting.reject(failure)
        if (phase === "capturing") {
          phase = "transferring"
          post({ type: "handover" })
        }
      }
      return waiting.promise
    },
    close: () => {
      if (phase === "adopted") return release()
      restore()
    },
  }
}
