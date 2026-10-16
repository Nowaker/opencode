import { expect, mock, setDefaultTimeout, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import type { Info } from "../../../src/config"
import { tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../../fixture/tui-sdk"

// The first test in the file also pays for starting the whole app.
setDefaultTimeout(30_000)

const sessionID = "ses_transcript_filter"
const created = 1_700_000_000_000
const session = {
  id: sessionID,
  title: "Filter fixture",
  slug: sessionID,
  projectID: "proj_test",
  directory,
  version: "0.0.0-test",
  time: { created, updated: created },
}
const model = { providerID: "test", modelID: "model" }
const assistantInfo = (id: string, finish: string) => ({
  id,
  sessionID,
  role: "assistant",
  parentID: "msg_0001",
  mode: "build",
  agent: "build",
  ...model,
  path: { cwd: directory, root: directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: created + 2, completed: created + 3 },
  finish,
})
const part = (messageID: string, index: number, body: Record<string, unknown>) => ({
  id: `prt_${messageID}_${index}`,
  sessionID,
  messageID,
  ...body,
})
const tool = (messageID: string, index: number, name: string, input: Record<string, unknown>, metadata = {}) =>
  part(messageID, index, {
    type: "tool",
    callID: `call_${index}`,
    tool: name,
    state: {
      status: "completed",
      input,
      output: "ok",
      title: name,
      metadata,
      time: { start: created, end: created + 1 },
    },
  })
const todos = [{ status: "completed", content: "first todo", priority: "high" }]

const transcript = [
  {
    info: { id: "msg_0001", sessionID, role: "user", agent: "build", model, time: { created } },
    parts: [part("msg_0001", 0, { type: "text", text: "inspect the repo" })],
  },
  {
    info: assistantInfo("msg_0002", "tool-calls"),
    parts: [
      part("msg_0002", 0, {
        type: "reasoning",
        text: "**Planning**\n\nlook around",
        time: { start: created, end: created + 1 },
      }),
      part("msg_0002", 1, { type: "text", text: "Looking around first", time: { start: created, end: created } }),
      tool("msg_0002", 2, "read", { filePath: `${directory}/alpha.ts` }),
      tool("msg_0002", 3, "bash", { command: "bun test" }, { output: "3 pass" }),
      tool("msg_0002", 4, "webfetch", { url: "https://example.com/fetched" }),
      tool("msg_0002", 5, "todowrite", { todos }, { todos }),
    ],
  },
  {
    info: assistantInfo("msg_0003", "stop"),
    parts: [
      part("msg_0003", 0, { type: "text", text: "All done final answer", time: { start: created, end: created } }),
    ],
  },
]

async function wait(fn: () => boolean, timeout = 10_000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

type Rig = {
  api: TuiPluginApi
  frame(): string
  press(bytes: string): Promise<void>
  click(label: string): Promise<void>
  render(): Promise<void>
}

async function withSession(
  body: (rig: Rig) => Promise<void>,
  options: { width: number; height?: number; config?: Info; kv?: Record<string, unknown>; until?: string },
) {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, JSON.stringify(options.kv ?? {}))
  const setup = await createTestRenderer({ width: options.width, height: options.height ?? 40, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const calls = createFetch((url) => {
    if (url.pathname === "/session") return json([session])
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) return json(transcript)
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
  const render = async () => {
    await setup.renderOnce()
    await setup.renderOnce()
  }

  try {
    const { run } = await import("../../../src/app")
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {}, ...options.config }),
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
      return frame().includes(options.until ?? "inspect the repo") && api.prompt.snapshot().ready
    })
    await Bun.sleep(150)
    await render()
    await body({
      api,
      frame,
      render,
      async press(bytes) {
        setup.renderer.stdin.emit("data", Buffer.from(bytes))
        await Bun.sleep(30)
        await render()
      },
      async click(label) {
        const lines = frame().split("\n")
        const y = lines.findIndex((line) => line.includes(label))
        if (y === -1) throw new Error(`"${label}" is not on screen:\n${frame()}`)
        await setup.mockMouse.click(lines[y].indexOf(label) + 1, y)
        await Bun.sleep(30)
        await render()
      },
    })
    api.keymap.dispatchCommand("app.exit")
    await task
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
}

const SPACE = " "
const DOWN = "\x1b[B"
const ENTER = "\r"
const kindsInOrder = [
  "Prompts",
  "Final answers",
  "Questions",
  "Errors",
  "Notices",
  "Todos",
  "Subagents",
  "Progress notes",
  "File actions",
  "Tool calls",
  "Thinking",
  "Compaction markers",
  "Turn footers",
]

async function openFilter(rig: Rig) {
  rig.api.keymap.dispatchCommand("session.transcript_filter")
  await wait(() => {
    void rig.render()
    return rig.frame().includes("Transcript filter")
  })
}

for (const width of [40, 80, 160]) {
  test(`the dialog lists every kind in order of importance at ${width} columns`, async () => {
    await withSession(
      async (rig) => {
        expect(rig.frame()).toContain("Thought: Planning")
        await openFilter(rig)
        const frame = rig.frame()
        const rows = kindsInOrder.map((label) => frame.indexOf(`[x] ${label}`))
        expect(rows.every((row) => row >= 0)).toBe(true)
        expect(rows).toEqual(rows.toSorted((a, b) => a - b))
        expect(frame.split("\n").every((line) => line.length <= width)).toBe(true)
        expect(frame).toContain("space show/hide")
      },
      { width },
    )
  })
}

test("unticking thinking, keeping only bash and hiding file actions update the transcript live", async () => {
  await withSession(
    async (rig) => {
      await openFilter(rig)
      for (let step = 0; step < 10; step++) await rig.press(DOWN)
      await rig.press(SPACE)
      // At 160 columns the transcript's left edge stays visible beside the dialog.
      expect(rig.frame()).not.toContain("Thought: Planning")
      await rig.click("[x] Tool calls")
      expect(rig.frame()).toContain("[ ] Tool calls")
      expect(rig.frame()).toContain("[ ] webfetch")
      await rig.click("[ ] bash")
      expect(rig.frame()).toContain("[x] bash")
      await rig.click("[x] File actions")
      expect(rig.frame()).toContain("[ ] Reads")
      await rig.press(ENTER)
      await wait(() => !rig.frame().includes("Transcript filter"))
      const frame = rig.frame()
      expect(frame).toContain("bun test")
      expect(frame).not.toContain("example.com/fetched")
      expect(frame).not.toContain("alpha.ts")
      expect(frame).not.toContain("Thought: Planning")
      expect(frame).toContain("first todo")
      expect(frame).toContain("All done final answer")
    },
    { width: 160 },
  )
})

test("transcript.show in tui.json hides a kind from the start", async () => {
  await withSession(
    async (rig) => {
      expect(rig.frame()).not.toContain("Thought: Planning")
      expect(rig.frame()).not.toContain("Looking around first")
      expect(rig.frame()).toContain("All done final answer")
    },
    { width: 80, config: { transcript: { show: { thinking: false, notes: false } } } },
  )
})

test("a session the filter hides entirely says so in one line", async () => {
  await withSession(
    async (rig) => {
      expect(rig.frame()).toContain("Everything here is hidden by the transcript filter")
      expect(rig.frame()).not.toContain("inspect the repo")
    },
    {
      width: 160,
      until: "Everything here is hidden",
      config: {
        transcript: {
          show: {
            prompts: false,
            answers: false,
            questions: false,
            errors: false,
            notices: false,
            todos: false,
            subagents: false,
            notes: false,
            file_actions: false,
            tools: false,
            thinking: false,
            compaction: false,
            footers: false,
          },
        },
      },
    },
  )
})
