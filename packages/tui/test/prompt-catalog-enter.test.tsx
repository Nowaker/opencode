import { expect, jest, test } from "bun:test"
import { TextareaRenderable, type Clock } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Schema } from "effect"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { PromptInput } from "@opencode/schema/prompt-input"
import { SessionMessage } from "@opencode/schema/session-message"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

const decodeAgentSwitch = Schema.decodeUnknownSync(Schema.Struct({ agent: Agent.ID }))
const decodeModelSwitch = Schema.decodeUnknownSync(Schema.Struct({ model: Model.Ref }))
const decodePrompt = Schema.decodeUnknownSync(Schema.Struct({ id: SessionMessage.ID, ...PromptInput.Prompt.fields }))

// Timer functions saved before fake timers are installed stay real, so the renderer keeps scheduling
// frames on real time while the test fakes the composer's submit deferral.
const liveTimers = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
}
const rendererClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, delayMs) => liveTimers.setTimeout(fn, delayMs),
  clearTimeout: (handle) => liveTimers.clearTimeout(handle),
  setInterval: (fn, delayMs) => liveTimers.setInterval(fn, delayMs),
  clearInterval: (handle) => liveTimers.clearInterval(handle),
}

test("Enter pressed while catalogs load admits the retained prompt once with the session selection", async () => {
  // The draft stash is process-wide, so reruns use a fresh session for an empty composer.
  const sessionID = `ses_catalog_enter_${crypto.randomUUID()}`
  const intent = "keep this cold Enter"
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  // The session's durable agent and model differ from the first catalog entries, so a submit that
  // fell back to catalog defaults instead of the normal session selection would commit plan/first.
  const catalogs: Record<string, unknown[]> = {
    "/api/agent": ["plan", "build"].map((id) => ({ id, mode: "primary", hidden: false, permissions: [] })),
    "/api/model": ["First", "Second"].map((name) => ({
      id: name.toLowerCase(),
      providerID: "demo",
      name: `${name} Model`,
      variants: [],
      cost: [],
      time: { released: 0 },
    })),
  }
  // Every catalog request waits for the release, so both stay unloaded until then even if the
  // model list is first read later. The agent list is read as the composer mounts.
  const agentsRequested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const admitted = Promise.withResolvers<void>()
  const mutations: string[] = []
  const terminal = await createTestRenderer({ width: 100, height: 30, kittyKeyboard: true, clock: rendererClock })
  await terminal.renderer.setupTerminal()
  await using setup = await createAppFixture({
    setup: terminal,
    args: { sessionID },
    fetch: async (url, request) => {
      if (url.pathname === `/api/session/${sessionID}`)
        return json({
          data: {
            id: sessionID,
            projectID: "project",
            title: "Catalog Enter fixture",
            agent: "build",
            model: { providerID: "demo", id: "second" },
            location: { directory },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 0, updated: 0 },
          },
        })
      if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
      if (url.pathname === `/api/session/${sessionID}/inbox` || url.pathname === `/api/session/${sessionID}/permission`)
        return json({ data: [] })
      const catalog = catalogs[url.pathname]
      if (catalog) {
        if (url.pathname === "/api/agent") agentsRequested.resolve()
        await release.promise
        return json({ location, data: catalog })
      }
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === `/api/session/${sessionID}/agent`) {
        mutations.push(`agent:${decodeAgentSwitch(await request.json()).agent}`)
        return new Response(null, { status: 204 })
      }
      if (url.pathname === `/api/session/${sessionID}/model`) {
        const model = decodeModelSwitch(await request.json()).model
        mutations.push(`model:${model.providerID}/${model.id}/${model.variant ?? "default"}`)
        return new Response(null, { status: 204 })
      }
      if (url.pathname === `/api/session/${sessionID}/prompt`) {
        const body = decodePrompt(await request.json())
        mutations.push(`prompt:${body.text}`)
        admitted.resolve()
        return json({
          data: {
            id: body.id,
            sessionID,
            type: "user",
            time: { created: 10 },
            payload: { text: body.text },
            delivery: "steer",
          },
        })
      }
      return undefined
    },
  })
  try {
    await setup.ready
    await agentsRequested.promise
    await setup.waitForFrame(() => setup.renderer.currentFocusedRenderable instanceof TextareaRenderable)
    const composer = setup.renderer.currentFocusedRenderable
    if (!(composer instanceof TextareaRenderable)) throw new Error("the prompt textarea lost focus")
    await setup.mockInput.typeText(intent)
    await setup.waitForFrame((frame) => frame.includes(intent))

    // The textarea's onSubmit calls submit() two zero-delay timers after Enter. The fake window is
    // synchronous, so it runs exactly those two callbacks and submit()'s synchronous guards before
    // the catalogs are released, and no other code runs while the timers are fake.
    jest.useFakeTimers()
    try {
      setup.mockInput.pressEnter()
      expect(jest.getTimerCount()).toBe(1)
      jest.advanceTimersToNextTimer()
      expect(jest.getTimerCount()).toBe(1)
      jest.advanceTimersToNextTimer()
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
    expect({ composer: composer.plainText, mutations }).toEqual({ composer: intent, mutations: [] })

    release.resolve()
    await setup.waitForFrame((frame) => frame.includes("Second Model"))
    // Admission is optimistic: the prompt leaves the composer and renders as a transcript row
    // before its request is sent.
    await setup.waitForFrame((frame) => composer.plainText === "" && frame.includes(intent))
    await admitted.promise
    await setup.waitForVisualIdle({ quietFrames: 3 })
    expect(setup.captureCharFrame().split(intent)).toHaveLength(2)
    expect(mutations).toEqual(["model:demo/second/default", `prompt:${intent}`])
  } finally {
    release.resolve()
  }
})
