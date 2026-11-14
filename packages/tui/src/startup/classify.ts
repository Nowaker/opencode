import fs from "node:fs"
import path from "node:path"
import type { StartupFrame } from "./frame"

const BOOLEAN_FLAGS = new Set(["--standalone", "--auto", "--yolo", "--dangerously-skip-permissions", "--print-logs"])
const VALUE_FLAGS = new Set(["--server", "--server-wait", "-s", "--session", "--prompt"])
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
  const wait = values.get("--server-wait")
  if (
    wait !== undefined &&
    (!values.has("--server") || !/^\d+$/.test(wait) || Number(wait) < 1 || Number(wait) > 2_147_483_647)
  )
    return
  const route: StartupFrame.Route = resume || values.has("--session") ? "session" : "home"
  return { route, prompt: values.get("--prompt"), ...(wait !== undefined ? { wait: true } : {}) }
}
