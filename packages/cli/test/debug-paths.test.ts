import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { isolatedEnv } from "./fixture/environment"

describe("debug paths command", () => {
  test("is included in troubleshooting help", async () => {
    const [debug, paths] = await Promise.all([cli(["debug", "--help"]), cli(["debug", "paths", "--help"])])

    expect(debug.exitCode).toBe(0)
    expect(debug.stdout).toContain("paths")
    expect(debug.stdout).toContain("Show global paths (data, config, cache, state)")
    expect(paths.exitCode).toBe(0)
    expect(paths.stdout).toContain("opencode debug paths [flags]")
  })

  test.each(["default", "explicit"] as const)(
    "prints resolved global paths with %s config without starting a server",
    async (mode) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-debug-paths-"))
      const config = mode === "explicit" ? path.join(root, "chosen-config") : undefined

      try {
        const result = await cli(
          ["debug", "paths"],
          isolatedEnv(root, {
            XDG_CONFIG_HOME: path.join(root, "config"),
            OPENCODE_CONFIG_DIR: config,
            OPENCODE_DB: ":memory:",
          }),
        )
        const paths = Object.fromEntries(
          result.stdout
            .trim()
            .split("\n")
            .map((line) => line.trim().split(/\s+/, 2)),
        )

        expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" })
        expect(paths).toMatchObject({
          home: root,
          data: path.join(root, "data", "opencode2"),
          config: config ?? path.join(root, "config", "opencode2"),
          cache: path.join(root, "cache", "opencode2"),
          state: path.join(root, "state", "opencode2"),
          bin: path.join(root, "cache", "opencode2", "bin"),
          log: path.join(root, "data", "opencode2", "log"),
          repos: path.join(root, "data", "opencode2", "repos"),
          db: ":memory:",
        })
        expect(paths.tmp).toBe(path.join(await fs.realpath(os.tmpdir()), "opencode2"))
        for (const file of ["service-local.json", "service.json"]) {
          expect(await Bun.file(path.join(root, "state", "opencode2", file)).exists()).toBe(false)
        }
      } finally {
        await fs.rm(root, { recursive: true, force: true })
      }
    },
  )
})

async function cli(args: string[], env?: Record<string, string | undefined>) {
  const child = Bun.spawn([process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), ...args], {
    cwd: path.join(import.meta.dir, ".."),
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}
