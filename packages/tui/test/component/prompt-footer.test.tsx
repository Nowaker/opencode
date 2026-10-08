import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../fixture/tui-sdk"

const sessionID = "ses_prompt_footer"
const session = {
  id: sessionID,
  title: "Prompt footer",
  slug: sessionID,
  projectID: "proj_test",
  directory,
  version: "0.0.0-test",
  time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
}
const model = { providerID: "test", modelID: "model" }

async function wait(fn: () => boolean, timeout = 10_000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

// Sends a prompt while a turn is running and returns the footer row once `expected` shows in it.
async function footerWhileRunning(answer: () => Promise<Response>, expected: string) {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const setup = await createTestRenderer({ width: 120, height: 24, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const calls = createFetch((url) => {
    if (url.pathname === "/session") return json([session])
    if (url.pathname === "/session/status") return json({ [sessionID]: { type: "busy" } })
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) return url.searchParams.has("limit") ? json([]) : answer()
    if (url.pathname.startsWith(`/session/${sessionID}/message/`))
      return json({ name: "NotFoundError", data: { message: "Message not found" } }, { status: 404 })
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    if (url.pathname === "/agent")
      return json([{ name: "build", mode: "primary", permission: [], options: {}, hidden: false }])
    if (url.pathname === "/config/providers")
      return json({
        providers: [
          {
            id: model.providerID,
            name: "Test",
            source: "config",
            env: [],
            options: {},
            models: { [model.modelID]: { id: model.modelID, name: "Model", providerID: model.providerID } },
          },
        ],
        default: { [model.providerID]: model.modelID },
      })
  })
  const started = Promise.withResolvers<TuiPluginApi>()
  const { run } = await import("../../src/app")
  const render = async () => {
    await setup.renderOnce()
    await setup.renderOnce()
  }
  const footer = () =>
    setup
      .captureCharFrame()
      .split("\n")
      .find((line) => line.includes("interrupt"))

  try {
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: createEventSource().source,
        args: { continue: true },
        pluginHost: {
          async start(input) {
            input.runtime.setupSlots(input.api)
            started.resolve(input.api)
          },
          async dispose() {},
        },
      }).pipe(
        Effect.provide(
          Global.layerWith({
            home: tmp.path,
            data: tmp.path,
            cache: tmp.path,
            config: tmp.path,
            state: tmp.path,
            tmp: tmp.path,
            bin: tmp.path,
            log: tmp.path,
            repos: tmp.path,
          }),
        ),
      ),
    )

    const api = await started.promise
    await wait(() => {
      void render()
      return Boolean(footer()?.includes("esc interrupt")) && api.prompt.snapshot().ready
    })
    const snapshot = api.prompt.snapshot()
    const guard = { generation: snapshot.generation, correlationId: "prompt-footer" }
    const replaced = api.prompt.replace({
      ...guard,
      sha256: snapshot.sha256,
      partsSha256: snapshot.partsSha256,
      text: "second prompt",
    })
    expect(
      api.prompt.submit({ ...guard, sha256: replaced.snapshot.sha256, partsSha256: replaced.snapshot.partsSha256 })
        .status,
    ).toBe("submitted")
    await wait(() => {
      void render()
      return Boolean(footer()?.includes(expected))
    })
    const line = footer()
    api.keymap.dispatchCommand("app.exit")
    await task
    return line
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
}

test("a prompt still sending shows two spaces after esc interrupt", async () => {
  const held = Promise.withResolvers<Response>()
  const line = await footerWhileRunning(() => held.promise, "Sending prompt").finally(() =>
    held.resolve(json({}, { status: 502 })),
  )
  expect(line).toMatch(/esc interrupt {2}\S+ Sending prompt/)
})

test("a rejected prompt's notice shows two spaces after esc interrupt", async () => {
  const line = await footerWhileRunning(
    async () => json({ name: "UnknownError", data: { message: "database is locked" } }, { status: 500 }),
    "Not sent",
  )
  expect(line).toMatch(/esc interrupt {2}Not sent \(database is locked\)/)
})

test("an unconfirmed prompt's notice shows two spaces after esc interrupt", async () => {
  const line = await footerWhileRunning(async () => new Response("bad gateway", { status: 502 }), "may not have")
  expect(line).toMatch(/esc interrupt {2}Prompt may not have been received/)
})
