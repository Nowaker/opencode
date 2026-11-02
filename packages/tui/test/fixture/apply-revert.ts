import { expect, mock } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { GlobalEvent, Session } from "@opencode-ai/sdk/v2"
import { InputRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "./fixture"
import { createTuiResolvedConfig } from "./tui-runtime"
import { createEventSource, createFetch, directory, json } from "./tui-sdk"

// A directory to keep the frames each scenario asserts on, as QA evidence.
const evidenceDir = process.env.OPENCODE_APPLY_REVERT_EVIDENCE
export const sessionID = "ses_apply_revert"
const created = 1_700_000_000_000
const model = { providerID: "test", modelID: "model" }
export const session: Session = {
  id: sessionID,
  title: "Apply revert",
  slug: sessionID,
  projectID: "proj_test",
  directory,
  version: "0.0.0-test",
  time: { created, updated: created },
}
const message = (id: string, at: number, text: string, parentID?: string) => ({
  info: parentID
    ? {
        id,
        sessionID,
        role: "assistant",
        parentID,
        mode: "build",
        agent: "build",
        ...model,
        path: { cwd: directory, root: directory },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: created + at, completed: created + at + 1 },
        finish: "stop",
      }
    : { id, sessionID, role: "user", agent: "build", model, time: { created: created + at } },
  parts: [{ id: `prt_${id}`, sessionID, messageID: id, type: "text", text, time: { start: created, end: created } }],
})
const transcript = [
  message("msg_0001", 1, "first question"),
  message("msg_0002", 2, "first answer", "msg_0001"),
  message("msg_0003", 4, "second question"),
  message("msg_0004", 5, "second answer", "msg_0003"),
]
export const revertPath = `/session/${sessionID}/revert`
export const applyPath = `/session/${sessionID}/revert/apply`
export const unrevertPath = `/session/${sessionID}/unrevert`
// Every route that starts a turn on the server, and with it an LLM call.
const promptPaths = ["message", "prompt_async", "command", "shell"].map((route) => `/session/${sessionID}/${route}`)
export const ENTER = "\r"
const CTRL_P = "\x10"

export type Rig = ReturnType<typeof createRig>

/**
 * Runs the real TUI on a test renderer against a wire-level fake server, whose session is reverted to the second
 * prompt when `reverted`. The POSTs under test wait for the scenario to answer them through `rig.gate`. Once the
 * app exited, every request an action started has been made, so the log proves no turn was ever started, unless
 * the scenario starts `turns` itself.
 */
export async function withApp(
  options: { width: number; reverted?: boolean; mode?: "dark" | "light"; turns?: boolean },
  body: (rig: Rig) => Promise<void>,
) {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, JSON.stringify(options.mode ? { theme_mode_lock: options.mode } : {}))
  const setup = await createTestRenderer({ width: options.width, height: 40, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const server = {
    session: { ...session, revert: options.reverted ? { messageID: "msg_0003" } : undefined },
    messages: transcript,
  }
  const events = createEventSource()
  const requests: { method: string; path: string; body?: string }[] = []
  const gates = new Map<string, PromiseWithResolvers<Response>[]>()
  const checks = new Set<() => void>()
  const check = () => checks.forEach((run) => run())
  const calls = createFetch((url) => {
    if (url.pathname === "/session") return json([server.session])
    if (url.pathname === `/session/${sessionID}`) return json(server.session)
    if (url.pathname === `/session/${sessionID}/message`) return json(server.messages)
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
  const fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const call = {
        method: request.method,
        path: new URL(request.url).pathname,
        ...(request.method === "POST" ? { body: await request.clone().text() } : {}),
      }
      requests.push(call)
      check()
      if (call.method !== "POST") return calls.fetch(input, init)
      const gate = gates.get(call.path)?.shift()
      const response = await (gate?.promise ?? json({ message: `unexpected POST ${call.path}` }, { status: 500 }))
      queueMicrotask(check)
      return response
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const started = Promise.withResolvers<TuiPluginApi>()

  try {
    const { run } = await import("../../src/app")
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch,
        events: events.source,
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
    // Checks rerun on each drawn frame, focus change, fetch and synced event: the moments the TUI can change.
    setup.renderer.on("frame", check)
    setup.renderer.on("focused_renderable", check)
    for (const type of ["session.updated", "session.status", "message.removed"] as const)
      api.event.on(type, () => queueMicrotask(check))
    const rig = createRig({ api, setup, server, requests, gates, checks, emit: events.emit })
    await body(rig)
    api.keymap.dispatchCommand("app.exit")
    await task
    setup.renderer.off("frame", check)
    setup.renderer.off("focused_renderable", check)
    if (!options.turns)
      expect(requests.filter((call) => call.method === "POST" && promptPaths.includes(call.path))).toEqual([])
    return rig
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
}

/** The revert card's text with its border and wrapping removed. */
export function cardText(frame: string) {
  const lines = frame.split("\n")
  const top = lines.findIndex((line) => line.includes("message reverted"))
  return lines
    .slice(
      top,
      lines.findIndex((line, index) => index > top && !line.includes("┃")),
    )
    .map((line) => line.replaceAll("┃", " ").trim())
    .join(" ")
    .replace(/\s+/g, " ")
}

function createRig(input: {
  api: TuiPluginApi
  setup: Awaited<ReturnType<typeof createTestRenderer>>
  server: { session: Session; messages: typeof transcript }
  requests: { method: string; path: string; body?: string }[]
  gates: Map<string, PromiseWithResolvers<Response>[]>
  checks: Set<() => void>
  emit: (event: GlobalEvent) => void
}) {
  const renderer = input.setup.renderer
  const frame = () => input.setup.captureCharFrame()
  const updates = { count: 0 }
  // Waits for the signal `start` subscribes to; the timeout only breaks a hung run and reports the last frame.
  const signal = (label: string, start: (done: () => void) => () => void) =>
    new Promise<void>((resolve, reject) => {
      const state = { settled: false, stop: () => {} }
      const finish = (error?: Error) => {
        if (state.settled) return
        state.settled = true
        clearTimeout(timer)
        state.stop()
        if (error) return reject(error)
        resolve()
      }
      const timer = setTimeout(() => finish(new Error(`timed out waiting for ${label}\n${frame()}`)), 15_000)
      const stop = start(() => finish())
      if (state.settled) return stop()
      state.stop = stop
    })
  const until = (label: string, probe: () => boolean) =>
    signal(label, (done) => {
      const run = () => probe() && done()
      input.checks.add(run)
      run()
      renderer.requestRender()
      return () => input.checks.delete(run)
    })
  // The stdin parser may hold a key back, so a press is done once the renderer dispatched every key in it.
  // Listening first sees each key before a handler can stop it.
  const press = (keys: string) =>
    signal(`${JSON.stringify(keys)} to be dispatched`, (done) => {
      const left = { count: keys.length }
      const seen = () => --left.count === 0 && done()
      renderer.keyInput.prependListener("keypress", seen)
      renderer.stdin.emit("data", Buffer.from(keys))
      return () => renderer.keyInput.off("keypress", seen)
    })
  const emit = (payload: GlobalEvent["payload"]) => input.emit({ directory, project: "proj_test", payload })
  const updated = (revert: Session["revert"]) => {
    input.server.session = { ...input.server.session, revert }
    const id = `evt_session_${++updates.count}`
    emit({ id, type: "session.updated", properties: { sessionID, info: input.server.session } })
  }
  return {
    api: input.api,
    frame,
    until,
    press,
    emit,
    updated,
    posts: (path: string) => input.requests.filter((call) => call.method === "POST" && call.path === path).length,
    bodies: (path: string) =>
      input.requests.flatMap((call) => (call.method === "POST" && call.path === path ? [JSON.parse(call.body ?? "null")] : [])),
    /** Holds the next POST to `path` until the scenario answers it. */
    gate(path: string) {
      const gate = Promise.withResolvers<Response>()
      input.gates.set(path, [...(input.gates.get(path) ?? []), gate])
      return gate
    },
    async click(label: string) {
      const lines = frame().split("\n")
      const y = lines.findIndex((line) => line.includes(label))
      if (y === -1) throw new Error(`"${label}" is not on screen:\n${frame()}`)
      await input.setup.mockMouse.click(lines[y].indexOf(label) + 1, y, undefined, { delayMs: 0 })
    },
    draft() {
      const snapshot = input.api.prompt.snapshot()
      return { sha256: snapshot.sha256, partsSha256: snapshot.partsSha256, input: input.api.prompt.read().input }
    },
    setDraft(text: string) {
      const snapshot = input.api.prompt.snapshot()
      const guard = { generation: snapshot.generation, sha256: snapshot.sha256, partsSha256: snapshot.partsSha256 }
      expect(input.api.prompt.replace({ ...guard, correlationId: "apply-revert", text }).status).toBe("accepted")
    },
    // Assistant text renders after the rest, moving what is below it, so the layout is final only once it shows.
    ready: (text: string) =>
      until(
        `"${text}", the first answer and a ready composer`,
        () => frame().includes(text) && frame().includes("first answer") && input.api.prompt.snapshot().ready,
      ),
    async palette(filter: string, found: boolean) {
      await press(CTRL_P)
      // The filter takes focus a tick after the dialog mounts; keys typed before that are lost.
      await until("the palette filter", () => renderer.currentFocusedRenderable instanceof InputRenderable)
      await press(filter)
      await until(`"${filter}" ${found ? "found" : "not found"}`, () => {
        const shown = frame()
        return shown.includes(filter) && shown.includes("No results found") !== found
      })
    },
    async closePalette() {
      input.api.ui.dialog.clear()
      await until("the palette to close", () => !frame().includes("Commands"))
    },
    /** What the server emits once applying a revert deleted the reverted messages, synced. */
    applied() {
      input.server.messages = transcript.slice(0, 2)
      emit({ id: "evt_removed_3", type: "message.removed", properties: { sessionID, messageID: "msg_0003" } })
      emit({ id: "evt_removed_4", type: "message.removed", properties: { sessionID, messageID: "msg_0004" } })
      updated(undefined)
      const synced = () =>
        input.api.state.session.messages(sessionID).length === 2 && !input.api.state.session.get(sessionID)?.revert
      return until(
        "the applied revert to sync and its card to go",
        () => synced() && !frame().includes("message reverted"),
      )
    },
    messageIDs: () => input.api.state.session.messages(sessionID).map((item) => item.id),
    async evidence(name: string) {
      if (!evidenceDir) return
      const span = input.setup
        .captureSpans()
        .lines.flatMap((line) => line.spans)
        .find((item) => item.text.includes("pply revert"))
      const color = span && [span.fg.r, span.fg.g, span.fg.b].map((value) => Math.round(value * 255))
      await Bun.write(`${evidenceDir}/${name}.txt`, `${frame()}\napply action fg: ${JSON.stringify(color)}\n`)
    },
  }
}
