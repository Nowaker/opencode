import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// The parent owns scratch so even a failed preload or abrupt test-process exit
// cannot bypass teardown. Never sweep siblings belonging to another invocation.
const state: { child?: Pick<Bun.Subprocess, "kill">; signal?: "SIGINT" | "SIGTERM" | "SIGHUP" } = {}
const handlers = (["SIGINT", "SIGTERM", "SIGHUP"] as const).map((signal) => {
  const listener = () => {
    state.signal = signal
    process.exitCode = 128 + os.constants.signals[signal]
    state.child?.kill(signal)
  }
  process.on(signal, listener)
  return { signal, listener }
})
try {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-test-run-"))
  try {
    const dirs = {
      TMPDIR: path.join(root, "tmp"),
      TMP: path.join(root, "tmp"),
      TEMP: path.join(root, "tmp"),
      HOME: path.join(root, "home"),
      USERPROFILE: path.join(root, "home"),
      XDG_DATA_HOME: path.join(root, "share"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_STATE_HOME: path.join(root, "state"),
      NODE_COMPILE_CACHE: path.join(root, "node-cache"),
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: path.join(root, "bun-cache"),
      OPENCODE_TOOLS_DATA_DIR: path.join(root, "tools"),
      OPENCODE_PLUGINS_DATA_DIR: path.join(root, "plugins"),
    }
    await Promise.all(Object.values(dirs).map((dir) => fs.mkdir(dir, { recursive: true })))
    if (!state.signal) {
      const child = Bun.spawn([process.execPath, "test", ...process.argv.slice(2)], {
        env: { ...process.env, ...dirs },
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      })
      state.child = child
      try {
        const code = await child.exited
        if (!state.signal) process.exitCode = code
      } finally {
        delete state.child
      }
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 })
  }
} finally {
  handlers.forEach(({ signal, listener }) => process.off(signal, listener))
}
