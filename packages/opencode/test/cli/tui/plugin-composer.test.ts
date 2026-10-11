import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../../fixture/fixture"
import { createTuiPluginApi } from "../../fixture/tui-plugin"
import { mockTuiRuntime } from "../../fixture/tui-runtime"

const { TuiPluginRuntime } = await import("../../../src/plugin/tui/runtime")

test("loaded plugins retire through the host with the original seal object", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const file = path.join(dir, "retirement.ts")
      await Bun.write(file, `export default {
        id: "demo.retirement",
        tui(api) {
          const result = api.prompt.seal()
          if (result.status !== "sealed") throw new Error("missing seal")
          api.lifecycle.retire(result.seal)
          api.lifecycle.onDispose(() => result.seal.release())
        },
      }`)
      return pathToFileURL(file).href
    },
  })
  const { config, restore } = mockTuiRuntime(tmp.path, [tmp.extra])
  const api = createTuiPluginApi()
  let committed = false
  let releaseAfterCommit = false
  const release = () => {
    releaseAfterCommit = committed
    return !committed
  }
  const seal = { generation: 1, release, [Symbol.dispose]: release }
  api.prompt.seal = () => ({ status: "sealed", seal, draft: api.prompt.read() })
  api.lifecycle.retire = (input) => {
    expect(input).toBe(seal)
    committed = true
    return { status: "accepted" }
  }
  try {
    await TuiPluginRuntime.init({ api, config })
    expect(committed).toBe(true)
    await TuiPluginRuntime.dispose()
    expect(releaseAfterCommit).toBe(true)
  } finally {
    await TuiPluginRuntime.dispose()
    restore()
  }
})

test("hands a loaded plugin the host composer", async () => {
  // Given: a plugin that records the composer it was handed. The per-plugin api
  // is projected field by field rather than spread, so a capability the host
  // offers reaches a plugin only if that projection forwards it.
  await using tmp = await tmpdir({
    init: async (dir) => {
      const file = path.join(dir, "plugin.ts")
      const spec = pathToFileURL(file).href
      const marker = path.join(dir, "composer.txt")

      await Bun.write(
        file,
        `export default {
  id: "demo.composer",
  tui: async (api, options) => {
    await Bun.write(options.marker, JSON.stringify({
      present: typeof api.prompt?.snapshot === "function",
      generation: api.prompt?.snapshot().generation ?? null,
    }))
  },
}
`,
      )

      return { spec, marker }
    },
  })

  const { config, restore } = mockTuiRuntime(tmp.path, [[tmp.extra.spec, { marker: tmp.extra.marker }]])

  try {
    // When: the plugin runtime loads it against a host api.
    await TuiPluginRuntime.init({ api: createTuiPluginApi(), config })

    // Then: the plugin holds the host's own composer, not a substitute.
    expect(JSON.parse(await fs.readFile(tmp.extra.marker, "utf8"))).toEqual({
      present: true,
      generation: "fixture-composer",
    })
  } finally {
    await TuiPluginRuntime.dispose()
    restore()
  }
})
