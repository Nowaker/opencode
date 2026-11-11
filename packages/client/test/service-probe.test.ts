import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

test.each(["xdg", "home"])("both clients discover only the opencode2 registration with %s roots", (mode) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode2-service-probe-"))
  const home = path.join(root, "home")
  const state = mode === "xdg" ? path.join(root, "state") : path.join(home, ".local", "state")
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      "-e",
      `
        import assert from "node:assert/strict"
        import fs from "node:fs/promises"
        import path from "node:path"
        import { NodeFileSystem } from "@effect/platform-node"
        import { Effect } from "effect"
        import { Service } from "./src/promise/service.ts"
        import { discover } from "./src/effect/service.ts"
        import { fallback } from "./src/service-probe.ts"
        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: () => Response.json({ pid: process.pid, version: "test" }),
        })
        try {
          const url = new URL("/v2", server.url).href
          await fs.mkdir(path.dirname(fallback()), { recursive: true })
          await fs.writeFile(fallback(), JSON.stringify({ pid: process.pid, version: "test", url }))
          assert.deepEqual(await Service.discover(), { url, auth: undefined })
          assert.deepEqual(await Effect.runPromise(discover().pipe(Effect.provide(NodeFileSystem.layer))),
            { url, auth: undefined })
        } finally {
          await server.stop(true)
        }
      `,
    ],
    cwd: path.join(import.meta.dir, ".."),
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      OPENCODE_TEST_HOME: home,
      OPENCODE_CONFIG_DIR: path.join(root, "config"),
      OPENCODE_DB: path.join(root, "explicit.db"),
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_STATE_HOME: mode === "xdg" ? state : undefined,
      TMPDIR: root,
      TEMP: root,
    },
    stdout: "pipe",
    stderr: "pipe",
  })

  try {
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(fs.existsSync(path.join(state, "opencode"))).toBe(false)
    expect(fs.statSync(path.join(state, "opencode2", "service.json")).isFile()).toBe(true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
