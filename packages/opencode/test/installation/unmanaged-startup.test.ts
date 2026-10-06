import { expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"

test("unmanaged startup skips release lookup even when update notifications are enabled", async () => {
  // Given an isolated config requesting update notifications and an unmanaged build define.
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "config", "opencode", "opencode.json"), JSON.stringify({ autoupdate: "notify" }))
  await Bun.write(
    path.join(tmp.path, "startup.ts"),
    `
import { spyOn } from "bun:test"
import { Installation } from ${JSON.stringify(path.join(import.meta.dir, "../../src/installation"))}
import { upgrade } from ${JSON.stringify(path.join(import.meta.dir, "../../src/cli/upgrade"))}
import { AppRuntime } from ${JSON.stringify(path.join(import.meta.dir, "../../src/effect/app-runtime"))}
const lookup = spyOn(Installation, "latest").mockResolvedValue("99.0.0")
const method = spyOn(Installation, "method").mockResolvedValue("unknown")
try {
  await upgrade()
  console.log(JSON.stringify({ methods: method.mock.calls.length, lookups: lookup.mock.calls.length }))
} finally {
  lookup.mockRestore()
  method.mockRestore()
  await AppRuntime.dispose()
}
process.exit(0)
`,
  )
  // When the actual startup update function runs in a child with isolated XDG roots.
  const child = Bun.spawn(
    [process.execPath, "--define", 'OPENCODE_INSTALL_METHOD:"unknown"', path.join(tmp.path, "startup.ts")],
    {
      cwd: path.join(import.meta.dir, "../.."),
      env: {
        ...process.env,
        XDG_CONFIG_HOME: path.join(tmp.path, "config"),
        XDG_DATA_HOME: path.join(tmp.path, "data"),
        XDG_CACHE_HOME: path.join(tmp.path, "cache"),
        XDG_STATE_HOME: path.join(tmp.path, "state"),
        OPENCODE_DISABLE_AUTOUPDATE: "false",
        OPENCODE_ALWAYS_NOTIFY_UPDATE: "true",
        OPENCODE_TOOLS_DATA_DIR: path.join(tmp.path, "tools"),
        OPENCODE_PLUGINS_DATA_DIR: path.join(tmp.path, "plugins"),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const output = await new Response(child.stdout).text()
  // Then no release lookup occurs; the narrow registry spy prevents external traffic if the guard regresses.
  expect(await child.exited).toBe(0)
  expect(JSON.parse(output.trim().split("\n").at(-1) ?? "null")).toEqual({ methods: 0, lookups: 0 })
}, 30_000)
