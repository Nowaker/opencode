import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import type { Info } from "../../../src/config"
import { tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../../fixture/tui-sdk"

const sessionID = "ses_keep_scroll"
const session = {
  id: sessionID,
  title: "Keep scroll",
  slug: sessionID,
  projectID: "proj_test",
  directory,
  version: "0.0.0-test",
  time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
}
const model = { providerID: "test", modelID: "model" }

// One user message per turn, each several lines tall, so the transcript is far taller
// than the viewport and "at the bottom" and "scrolled up" show different text.
const transcript = Array.from({ length: 30 }, (_, index) => {
  const id = `msg_${String(index).padStart(4, "0")}`
  return {
    info: {
      id,
      sessionID,
      role: "user",
      agent: "build",
      model,
      time: { created: session.time.created + index },
    },
    parts: [
      {
        id: `prt_${String(index).padStart(4, "0")}`,
        sessionID,
        messageID: id,
        type: "text",
        text: [`turn ${index} opening`, `turn ${index} middle`, `turn ${index} closing`].join("\n"),
      },
    ],
  }
})

async function wait(fn: () => boolean, timeout = 5000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function submitWhileScrolledUp(config: Info, before?: (api: TuiPluginApi) => void) {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const prompts: string[] = []
  const calls = createFetch((url) => {
    if (url.pathname === "/session") return json([session])
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) {
      if (!url.searchParams.has("limit")) prompts.push(url.pathname)
      return json(transcript)
    }
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
  const frame = () => setup.captureCharFrame()

  try {
    const { run } = await import("../../../src/app")
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {}, ...config }),
        fetch: calls.fetch,
        events: createEventSource().source,
        args: { continue: true },
        pluginHost: {
          async start(input) {
            // The real host builds the slot registry; without it no session prompt mounts.
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
    const render = async () => {
      await setup.renderOnce()
      await setup.renderOnce()
    }
    await wait(() => {
      void render()
      return frame().includes("turn 29 closing") && api.prompt.snapshot().ready
    })
    // Opening a session jumps to the bottom 50 ms later; let that land before scrolling up.
    await Bun.sleep(150)
    before?.(api)

    api.keymap.dispatchCommand("session.page.up")
    api.keymap.dispatchCommand("session.page.up")
    await render()
    const scrolledUp = frame()
    expect(scrolledUp).not.toContain("turn 29 closing")

    const snapshot = api.prompt.snapshot()
    const guard = { generation: snapshot.generation, correlationId: "keep-scroll" }
    const replaced = api.prompt.replace({
      ...guard,
      sha256: snapshot.sha256,
      partsSha256: snapshot.partsSha256,
      text: "next question",
    })
    expect(replaced.status).toBe("accepted")
    const submitted = api.prompt.submit({
      ...guard,
      sha256: replaced.snapshot.sha256,
      partsSha256: replaced.snapshot.partsSha256,
    })
    expect(submitted.status).toBe("submitted")
    await wait(() => prompts.length === 1)
    // The jump to the bottom is deferred by 50 ms after submit.
    await Bun.sleep(150)
    await render()

    const after = frame()
    api.keymap.dispatchCommand("app.exit")
    await task
    return { scrolledUp, after }
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
}

function transcriptLines(frame: string) {
  return frame.split("\n").filter((line) => line.includes("turn "))
}

test("submitting a prompt scrolls a scrolled-up session to the bottom by default", async () => {
  const view = await submitWhileScrolledUp({})

  expect(view.after).toContain("turn 29 closing")
})

test("keep_scroll_on_submit leaves a scrolled-up session where it is", async () => {
  const view = await submitWhileScrolledUp({ keep_scroll_on_submit: true })

  expect(transcriptLines(view.after)).toEqual(transcriptLines(view.scrolledUp))
})

test("the keep-scroll toggle leaves a scrolled-up session where it is", async () => {
  const view = await submitWhileScrolledUp({}, (api) =>
    api.keymap.dispatchCommand("session.toggle.keep_scroll_on_submit"),
  )

  expect(transcriptLines(view.after)).toEqual(transcriptLines(view.scrolledUp))
})
