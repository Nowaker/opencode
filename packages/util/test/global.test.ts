import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { Context, Effect, Layer } from "effect"
import { Global } from "../src/global.js"

describe("global", () => {
  test("importing the module does not create directories", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-global-import-"))
    const directories = ["data", "cache", "config", "state", "tmp"].map((directory) => path.join(root, directory))
    const module = pathToFileURL(path.join(import.meta.dir, "../src/global.ts")).href
    const result = Bun.spawnSync({
      cmd: [process.execPath, "-e", `const { Global } = await import(${JSON.stringify(module)}); void Global.Path.tmp`],
      env: {
        ...process.env,
        HOME: root,
        USERPROFILE: root,
        OPENCODE_TEST_HOME: root,
        XDG_DATA_HOME: directories[0],
        XDG_CACHE_HOME: directories[1],
        XDG_CONFIG_HOME: directories[2],
        XDG_STATE_HOME: directories[3],
        // os.tmpdir() reads TMPDIR on POSIX and TEMP on Windows.
        TMPDIR: directories[4],
        TEMP: directories[4],
      },
      stderr: "pipe",
    })

    expect(result.exitCode, result.stderr.toString()).toBe(0)
    directories.forEach((directory) => {
      expect(fs.existsSync(path.join(directory, "opencode"))).toBe(false)
      expect(fs.existsSync(path.join(directory, "opencode2"))).toBe(false)
    })
    fs.rmSync(root, { recursive: true, force: true })
  })

  test("building layerWith creates service directories and preserves an explicit tmp", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-global-layer-"))
    const directories = {
      data: path.join(root, "data"),
      config: path.join(root, "config"),
      state: path.join(root, "state"),
      log: path.join(root, "log"),
      bin: path.join(root, "bin"),
      repos: path.join(root, "repos"),
      tmp: path.join(root, "nested", "..", "tmp"),
    }

    const context = await Effect.runPromise(Effect.scoped(Layer.build(Global.layerWith(directories))))

    Object.values(directories).forEach((directory) => expect(fs.statSync(directory).isDirectory()).toBe(true))
    expect(Context.get(context, Global.Service).tmp).toBe(directories.tmp)
    fs.rmSync(root, { recursive: true, force: true })
  })

  test.each(["xdg", "home"])("global node writes only beneath opencode2 with %s roots and explicit config", (mode) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-global-layer-"))
    const home = path.join(root, "home")
    const directories =
      mode === "xdg"
        ? ["data", "cache", "config", "state", "tmp"].map((directory) => path.join(root, directory))
        : [
            path.join(home, ".local", "share"),
            path.join(home, ".cache"),
            path.join(home, ".config"),
            path.join(home, ".local", "state"),
            path.join(root, "tmp"),
          ]
    const config = path.join(root, "explicit-config")
    const module = pathToFileURL(path.join(import.meta.dir, "../src/global.ts")).href
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        "-e",
        `
          import { Context, Effect, Layer } from "effect"
          import fs from "node:fs/promises"
          import path from "node:path"
          import { LayerNode } from "@opencode/util/effect/layer-node"
          const { Global } = await import(${JSON.stringify(module)})
          const context = await Effect.runPromise(Effect.scoped(Layer.build(LayerNode.compile(Global.node))))
          const global = Context.get(context, Global.Service)
          for (const directory of [global.data, global.cache, global.state, global.bin, global.log,
            global.repos, global.tmp, global.config, path.join(global.data, "snapshot")]) {
            await fs.mkdir(directory, { recursive: true })
            await fs.writeFile(path.join(directory, "root-write"), "isolated")
          }
          process.stdout.write(global.tmp)
        `,
      ],
      cwd: path.join(import.meta.dir, ".."),
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        OPENCODE_TEST_HOME: home,
        OPENCODE_CONFIG_DIR: config,
        OPENCODE_DB: path.join(root, "explicit.db"),
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: path.join(root, "transpiler-cache"),
        XDG_DATA_HOME: mode === "xdg" ? directories[0] : "",
        XDG_CACHE_HOME: mode === "xdg" ? directories[1] : "",
        XDG_CONFIG_HOME: mode === "xdg" ? directories[2] : "",
        XDG_STATE_HOME: mode === "xdg" ? directories[3] : "",
        // os.tmpdir() reads TMPDIR on POSIX and TEMP on Windows.
        TMPDIR: directories[4],
        TEMP: directories[4],
      },
      stdout: "pipe",
      stderr: "pipe",
    })

    try {
      expect(result.exitCode, result.stderr.toString()).toBe(0)
      directories.forEach((directory) => expect(fs.existsSync(path.join(directory, "opencode"))).toBe(false))
      // Native realpath also expands Windows 8.3 short names such as RUNNER~1.
      expect(result.stdout.toString()).toBe(fs.realpathSync.native(path.join(directories[4], "opencode2")))
      const created = [
        path.join(directories[0], "opencode2"),
        path.join(directories[1], "opencode2"),
        path.join(directories[1], "opencode2", "bin"),
        config,
        path.join(directories[3], "opencode2"),
        path.join(directories[0], "opencode2", "log"),
        path.join(directories[0], "opencode2", "repos"),
        path.join(directories[0], "opencode2", "snapshot"),
        path.join(directories[4], "opencode2"),
      ]
      created.forEach((directory) => expect(fs.readFileSync(path.join(directory, "root-write"), "utf8")).toBe("isolated"))
      expect(fs.existsSync(path.join(directories[2], "opencode2"))).toBe(false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
