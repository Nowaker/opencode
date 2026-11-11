import { expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../../../../core/test/fixture/tmpdir"

test("debug archive includes both v2 log roots and excludes v1 logs", async () => {
  await using tmp = await tmpdir()
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `
      import assert from "node:assert/strict"
      import { mock } from "bun:test"
      import fs from "node:fs/promises"
      import path from "node:path"
      import { NodeServices } from "@effect/platform-node"
      import { Effect, Schema } from "effect"
      import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js"
      const root = process.env.LOGGING_TEST_ROOT
      assert(root)
      const paths = { userData: path.join(root, "desktop"), downloads: path.join(root, "downloads"), crashDumps: path.join(root, "crash") }
      await fs.mkdir(paths.downloads, { recursive: true })
      const logs = [path.join(root, "data", "opencode2", "log"), path.join(paths.userData, "opencode2", "log")]
      for (const [index, directory] of logs.entries()) {
        await fs.mkdir(directory, { recursive: true })
        await fs.writeFile(path.join(directory, "current.log"), "v2-" + index)
        const legacy = directory.replace("opencode2", "opencode")
        await fs.mkdir(legacy, { recursive: true })
        await fs.writeFile(path.join(legacy, "current.log"), "v1-" + index)
      }
      const noop = () => {}
      mock.module("electron", () => ({
        app: { isPackaged: true, getPath: (name) => paths[name], getName: () => "Log fixture", getVersion: () => "test" },
        crashReporter: { start: noop },
        netLog: { currentlyLogging: false, startLogging: async () => {}, stopLogging: async () => {} },
        shell: { showItemInFolder: noop },
      }))
      mock.module("electron-log/main.js", () => ({ default: {
        transports: { file: {}, console: {} }, initialize: noop,
        scope: () => ({ silly: noop, debug: noop, info: noop, warn: noop, error: noop }),
      } }))
      const { DesktopLogging } = await import("./src/main/native/logging.ts")
      const output = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const logging = yield* DesktopLogging.Service
        return yield* logging.exportDebug
      }).pipe(Effect.provide(DesktopLogging.layer), Effect.provide(NodeServices.layer))))
      const archive = new ZipReader(new BlobReader(new Blob([await fs.readFile(output)])))
      try {
        const entries = await archive.getEntries()
        assert.deepEqual(entries.map((entry) => entry.filename).sort(), ["manifest.json", "server-1/current.log", "server-2/current.log"])
        for (const [index] of logs.entries()) {
          const entry = entries.find((entry) => entry.filename === "server-" + (index + 1) + "/current.log")
          assert(entry && !entry.directory)
          assert.equal(await entry.getData(new TextWriter()), "v2-" + index)
        }
        const entry = entries.find((entry) => entry.filename === "manifest.json")
        assert(entry && !entry.directory)
        const manifest = Schema.decodeUnknownSync(Schema.Struct({ serverLogs: Schema.Array(Schema.String) }))(JSON.parse(await entry.getData(new TextWriter())))
        assert.deepEqual(manifest.serverLogs, logs)
      } finally {
        await archive.close()
      }
    `,
    ],
    {
      cwd: path.resolve(import.meta.dir, "../../.."),
      env: {
        ...process.env,
        LOGGING_TEST_ROOT: tmp.path,
        HOME: path.join(tmp.path, "home"),
        XDG_DATA_HOME: path.join(tmp.path, "data"),
        XDG_CONFIG_HOME: path.join(tmp.path, "config"),
        XDG_CACHE_HOME: path.join(tmp.path, "cache"),
        XDG_STATE_HOME: path.join(tmp.path, "state"),
        OPENCODE_CONFIG_DIR: path.join(tmp.path, "config"),
        OPENCODE_DB: path.join(tmp.path, "v2.db"),
        OPENCODE_TOOLS_DATA_DIR: path.join(tmp.path, "tools"),
        OPENCODE_PLUGINS_DATA_DIR: path.join(tmp.path, "plugins"),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const timeout = setTimeout(() => child.kill("SIGKILL"), 25_000)
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(code, stdout + stderr).toBe(0)
  } finally {
    clearTimeout(timeout)
    child.kill()
    await child.exited
  }
})
