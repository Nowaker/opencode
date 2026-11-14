#!/usr/bin/env bun

import { StartupInput } from "@opencode/tui/startup"

declare const OPENCODE_VERSION: string | undefined
declare const OPENCODE_STARTUP_WORKER: string | undefined

// The Bun entrypoint. It takes the terminal for the default TUI's early input before evaluating the rest of the
// CLI, which the dynamic import keeps out of this module. The compiled executable bundles the worker as a sibling
// entrypoint whose name the build defines.
const early = StartupInput.start({
  argv: process.argv.slice(2),
  env: process.env,
  worker: new URL(
    typeof OPENCODE_STARTUP_WORKER === "string" ? OPENCODE_STARTUP_WORKER : "./startup-worker.ts",
    import.meta.url,
  ),
  version: typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local",
})
const { main } = await import("./main").catch((error: unknown) => {
  early?.close()
  throw error
})
main(early)
