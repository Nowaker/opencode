import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { StartupInput } from "@opencode/tui/startup"
import type { main } from "./main"

declare const OPENCODE_VERSION: string | undefined

process.stdout.on("error", (error) => {
  if ("code" in error && error.code === "EPIPE") return
  throw error
})

// The Node entrypoint, after the SEA prelude has extracted the assets. The CLI and the early-input worker are
// separate asset files (see vite.node.config.ts), so nothing heavy evaluates before the terminal is taken.
const assets = process.env.OPENCODE_NODE_ASSETS_DIR
if (!assets) throw new Error("OPENCODE_NODE_ASSETS_DIR is not set by the Node prelude")
const early = StartupInput.start({
  argv: process.argv.slice(2),
  env: process.env,
  worker: pathToFileURL(path.join(assets, "startup-worker.mjs")),
  version: typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local",
})
const loader = path.join(assets, "opencode-loader.mjs")
const cli: { main: typeof main } = await createRequire(loader)(loader)
  .load(pathToFileURL(path.join(assets, "opencode-main.mjs")).href)
  .catch((error: unknown) => {
    early?.close()
    throw error
  })
cli.main(early)
