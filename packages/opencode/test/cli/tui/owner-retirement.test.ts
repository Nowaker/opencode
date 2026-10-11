import { expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../../fixture/fixture"

test("committed worker shutdown disposes instances without reopening work", async () => {
  await using tmp = await tmpdir({ git: true, config: { plugin: [] } })
  const worker = new Worker(new URL("../../fixture/owner-retirement-worker.ts", import.meta.url), {
    env: {
      ...process.env,
      HOME: tmp.path,
      XDG_CONFIG_HOME: path.join(tmp.path, "config"),
      XDG_DATA_HOME: path.join(tmp.path, "data"),
      XDG_CACHE_HOME: path.join(tmp.path, "cache"),
      XDG_STATE_HOME: path.join(tmp.path, "state"),
      OPENCODE_TOOLS_DATA_DIR: path.join(tmp.path, "tools"),
      OPENCODE_PLUGINS_DATA_DIR: path.join(tmp.path, "plugins"),
      OPENCODE_TEST_HOME: tmp.path,
      OPENCODE_TEST_MANAGED_CONFIG_DIR: path.join(tmp.path, "managed"),
      OPENCODE_CONFIG: path.join(tmp.path, "opencode.json"),
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    },
  })
  try {
    const retired = new Promise<string>((resolve, reject) => {
      worker.onmessage = (event) => {
        if (event.data === "retired") resolve(event.data)
      }
      worker.onerror = (event) => reject(new Error(event.message))
    })
    worker.postMessage(tmp.path)
    expect(await retired).toBe("retired")
  } finally {
    worker.terminate()
  }
}, 20_000)
