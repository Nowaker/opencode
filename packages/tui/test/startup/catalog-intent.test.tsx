import assert from "node:assert/strict"
import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import type { ComposerDraft, ComposerObservation, Destination } from "@opencode/plugin/tui/context"
import { draftText, frameText, mountCatalogSubmit, waitingForModels } from "../fixture/catalog-submit"

type ContentEdit = {
  readonly kind: "text" | "multi-chunk-revert" | "file" | "mention" | "pasted" | "mode"
  readonly initial: string
  readonly expected: Partial<ComposerDraft>
}
const edits: readonly ContentEdit[] = [
  { kind: "text", initial: draftText, expected: { text: `${draftText}x` } },
  { kind: "multi-chunk-revert", initial: draftText, expected: { text: draftText } },
  { kind: "file", initial: draftText, expected: { text: draftText, files: [{ uri: "data:text/plain;base64,QQ==" }] } },
  { kind: "mention", initial: "@plan draft", expected: { text: "@plan draft", agents: [{ name: "plan" }] } },
  {
    kind: "pasted",
    initial: draftText,
    expected: { text: draftText, pasted: [{ text: "expanded\npaste", source: { start: 0, end: 13, text: draftText } }] },
  },
  { kind: "mode", initial: draftText, expected: { text: draftText, mode: "shell" } },
]

test("a cancelled explicit submit is not revived by the matching --prompt one-shot", async () => {
  await using setup = await mountCatalogSubmit({ home: true, prompt: draftText })
  expect(setup.draft().text).toBe(draftText)
  setup.renderer.stdin.emit("data", Buffer.from("\r"))
  await setup.waitForFrame((frame) => waitingForModels.test(frameText(frame)))
  setup.renderer.stdin.emit("data", Buffer.from("x"))
  await setup.waitForFrame((frame) => !waitingForModels.test(frameText(frame)))
  setup.renderer.stdin.emit("data", Buffer.from("\x7f"))
  await setup.waitForFrame(() => setup.draft().text === draftText)
  await setup.release()
  await setup.renderOnce()
  expect(setup.draft().text).toBe(draftText)
  expect(setup.wire.writes).toHaveLength(0)
})

test.each(edits)("a $kind content change permanently cancels a waiting submit", async (row) => {
  await using setup = await mountCatalogSubmit()
  await setup.arm(row.initial)
  const prompt = setup.prompt.current
  assert.ok(prompt)
  switch (row.kind) {
    case "text":
      setup.renderer.stdin.emit("data", Buffer.from("x"))
      break
    case "multi-chunk-revert":
      setup.renderer.stdin.emit("data", Buffer.from("x"))
      await setup.waitForFrame((frame) => !waitingForModels.test(frameText(frame)))
      setup.renderer.stdin.emit("data", Buffer.from("\x7f"))
      break
    case "file":
      prompt.set({ ...prompt.current, files: [{ uri: "data:text/plain;base64,QQ==", name: "fixture.txt" }] })
      break
    case "mention":
      prompt.set({ ...prompt.current, agents: [{ name: "plan", mention: { start: 0, end: 5, text: "@plan" } }] })
      break
    case "pasted":
      prompt.set({
        ...prompt.current,
        pasted: [{ text: "expanded\npaste", source: { start: 0, end: 13, text: draftText } }],
      })
      break
    case "mode":
      await setup.mockInput.pressKey("a", { ctrl: true })
      await setup.waitForFrame(() => setup.draft().caret === 0)
      await setup.mockInput.typeText("!")
      break
    default: {
      const exhaustive: never = row.kind
      throw new Error(`Unexpected content edit ${exhaustive}`)
    }
  }
  await setup.waitForFrame((frame) => !waitingForModels.test(frameText(frame)))
  expect(frameText(setup.captureCharFrame())).not.toMatch(waitingForModels)
  expect(setup.draft()).toMatchObject(row.expected)
  await setup.release()
  await setup.renderOnce()
  expect(setup.local.model.catalogReady).toBe(true)
  expect(setup.draft()).toMatchObject(row.expected)
  expect(frameText(setup.captureCharFrame())).toContain(row.initial)
  expect(setup.wire.writes).toHaveLength(0)
})

test("a one-chunk edit and identical revert retains the waiting submit and sends once", async () => {
  await using setup = await mountCatalogSubmit()
  await setup.arm()
  setup.renderer.stdin.emit("data", Buffer.from("x\x7f"))
  await setup.waitForFrame((frame) => waitingForModels.test(frameText(frame)) && setup.draft().text === draftText)
  const bound = setup.bound()
  await setup.release()
  await bound
  await setup.wire.received()
  await setup.cleared()
  expect(setup.wire.prompts).toMatchObject([{ text: draftText }])
  expect(setup.wire.prompts).toHaveLength(1)
})

const moves = [
  { name: "caret", bytes: "\x1b[D\x1b[D", selection: { anchor: 11, focus: 11 } },
  { name: "backward selection", bytes: "\x1b[1;2D\x1b[1;2D", selection: { anchor: 13, focus: 11 } },
]
test.each(moves)("$name movement retains the waiting draft through the bound frame", async (row) => {
  await using setup = await mountCatalogSubmit()
  await setup.arm()
  setup.renderer.stdin.emit("data", Buffer.from(row.bytes))
  await setup.waitForFrame((frame) => waitingForModels.test(frameText(frame)))
  expect(setup.draft()).toMatchObject({ text: draftText, caret: 11, selection: row.selection })
  const observations: ComposerObservation[] = []
  const bound = setup.bound(() => observations.push(setup.composer.current()))
  await setup.release()
  await bound
  await setup.wire.received()
  expect(observations).toMatchObject([{ draft: { text: draftText, caret: 11, selection: row.selection } }])
  expect(setup.wire.prompts).toMatchObject([{ text: draftText }])
  expect(setup.wire.prompts).toHaveLength(1)
})

test("repeated native Enter coalesces into one send after the visible waiting frame", async () => {
  await using setup = await mountCatalogSubmit()
  await setup.arm()
  setup.renderer.stdin.emit("data", Buffer.from("\r\r"))
  await setup.waitForFrame((frame) => waitingForModels.test(frameText(frame)))
  expect(setup.draft().text).toBe(draftText)
  expect(setup.wire.writes).toHaveLength(0)
  const bound = setup.bound()
  await setup.release()
  await bound
  await setup.wire.received()
  await setup.cleared()
  expect(setup.wire.prompts).toHaveLength(1)
})

test("the delayed native submit retains the pair known at Enter across a background update and commits once", async () => {
  await using setup = await mountCatalogSubmit()
  await setup.context.data.session.sync("ses_observation_a")
  setup.renderer.stdin.emit("data", Buffer.from(draftText))
  const editor = setup.renderer.currentFocusedEditor
  assert.ok(editor instanceof TextareaRenderable)
  editor.submit()
  const info = setup.context.data.session.get("ses_observation_a")
  assert.ok(info)
  setup.data.session.remember({
    ...info,
    model: { providerID: "provider", id: "alternate", variant: "high" },
  })
  await setup.waitForFrame((frame) => waitingForModels.test(frameText(frame)))
  editor.submit()
  const published: string[] = []
  const bound = setup.bound(() => published.push(frameText(setup.captureCharFrame())))
  await setup.release()
  await bound
  expect(published).toHaveLength(1)
  expect(published[0]).toMatch(/\bPlan\b.*\bintended\b.*\blow\b/i)
  await setup.wire.received()
  await setup.cleared()
  expect(setup.wire.prompts).toHaveLength(1)
  expect(setup.wire.modelRequests).toEqual([{ providerID: "provider", id: "intended", variant: "low" }])
})

const owners: readonly { readonly name: string; readonly destination: Destination; readonly owner: string | null }[] = [
  { name: "Home", destination: { type: "home" }, owner: null },
  { name: "session and location", destination: { type: "session", sessionID: "ses_observation_b" }, owner: "ses_observation_b" },
  { name: "owner unmount", destination: { type: "plugin", name: "observation" }, owner: null },
]
test.each(owners)("a $name change cancels the old intent even after returning", async (row) => {
  await using setup = await mountCatalogSubmit()
  await setup.arm()
  setup.context.ui.router.navigate(row.destination)
  switch (row.destination.type) {
    case "plugin":
      await setup.waitForFrame((frame) => frame.includes("Observation page"))
      break
    case "home":
    case "session":
      await setup.waitForFrame(() => {
        const current = setup.composer.current()
        return current.status === "ready" && current.sessionID === row.owner
      })
      break
    default: {
      const exhaustive: never = row.destination
      throw new Error(`Unexpected destination ${exhaustive}`)
    }
  }
  setup.context.ui.router.navigate({ type: "session", sessionID: "ses_observation_a" })
  await setup.waitForFrame(() => {
    const current = setup.composer.current()
    return current.status === "ready" && current.sessionID === "ses_observation_a"
  })
  await setup.release()
  await setup.waitForFrame((frame) => !waitingForModels.test(frameText(frame)) && frame.includes(draftText))
  expect(setup.draft().text).toBe(draftText)
  expect(setup.wire.writes).toHaveLength(0)
})
