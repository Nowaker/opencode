import assert from "node:assert/strict"
import { beforeEach, expect, test } from "bun:test"
import { createComputed, createRoot } from "solid-js"
import { TextareaRenderable } from "@opentui/core"
import type { ComposerObservation } from "@opencode/plugin/tui/context"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { composerEditor, mountComposer } from "./fixture/composer"

beforeEach(() => takeDraft(undefined))

test.each([true, false])("native display offsets preserve selection direction (backward: %s)", async (backward) => {
  await using setup = await mountComposer()
  await setup.waitFor(() => setup.composer.current().status === "ready")
  await setup.mockInput.pasteBracketedText("A中\t🙂\nZ")
  await setup.waitFor(() => {
    const value = setup.composer.current()
    return value.status === "ready" && value.draft.text === "A中\t🙂\nZ"
  })
  await setup.renderOnce()
  const editor = composerEditor(setup)
  const start = editor.editBuffer.measureText("A中\t🙂\n")
  const end = editor.editBuffer.measureText("A中\t🙂\nZ")
  const caret = backward ? start : end
  const anchor = backward ? end : start
  editor.cursorOffset = anchor
  if (backward) editor.moveCursorLeft({ select: true })
  if (!backward) editor.moveCursorRight({ select: true })
  const observation = setup.composer.current()
  assert.equal(observation.status, "ready")
  expect(observation).toEqual({
    status: "ready",
    kind: "final",
    sessionID: null,
    draft: {
      text: "A中\t🙂\nZ",
      files: [],
      agents: [],
      skills: [],
      pasted: [],
      mode: "normal",
      caret,
      selection: { anchor, focus: caret },
    },
  })
  expect(editor.getSelectedText()).toBe("Z")
  await setup.waitFor(() => {
    const last = setup.changes.at(-1)
    return last?.status === "ready" && last.draft.caret === caret && last.draft.selection.anchor === anchor
  })
  expect(setup.changes.at(-1)).toEqual(observation)
})

test("current participates in Solid and subscriptions emit immediately until disposed", async () => {
  await using setup = await mountComposer()
  await setup.waitFor(() => setup.composer.current().status === "ready")
  const reactive: ComposerObservation[] = []
  const subscribed: ComposerObservation[] = []
  const dispose = createRoot((dispose) => {
    createComputed(() => reactive.push(setup.composer.current()))
    return dispose
  })
  const stop = setup.composer.subscribe((value) => subscribed.push(value))
  expect(subscribed).toHaveLength(1)
  await setup.mockInput.typeText("draft")
  expect(reactive.at(-1)).toEqual(setup.composer.current())
  expect(subscribed.at(-1)).toEqual(setup.composer.current())
  stop()
  stop()
  dispose()
  const count = subscribed.length
  await setup.mockInput.typeText(" later")
  expect(subscribed).toHaveLength(count)
  expect(subscribed.at(-1)).toMatchObject({ draft: { text: "draft" } })
})

test("a pointer click clearing selection publishes a collapsed range even when the caret stays put", async () => {
  await using setup = await mountComposer()
  await setup.waitFor(() => setup.composer.current().status === "ready")
  await setup.mockInput.typeText("ABCDE")
  await setup.renderOnce()
  const editor = composerEditor(setup)
  editor.gotoBufferHome()
  editor.gotoBufferEnd({ select: true })
  await setup.waitFor(() => {
    const value = setup.changes.at(-1)
    return value?.status === "ready" && value.draft.selection.anchor === 0 && value.draft.selection.focus === 5
  })
  await setup.mockMouse.click(editor.x + 5, editor.y)
  await setup.waitFor(() => {
    const value = setup.changes.at(-1)
    return value?.status === "ready" && value.draft.selection.anchor === 5 && value.draft.selection.focus === 5
  })
  expect(setup.composer.current()).toMatchObject({ draft: { caret: 5, selection: { anchor: 5, focus: 5 } } })
  expect(editor.getSelection()).toBeNull()
})

test("a focused native dialog input does not replace the mounted final composer", async () => {
  await using setup = await mountComposer()
  await setup.waitFor(() => setup.composer.current().status === "ready")
  await setup.mockInput.typeText("final draft")
  const editor = composerEditor(setup)
  const draft = setup.composer.current()
  const answer = setup.context.ui.dialog.prompt({ title: "Observation form", value: "form: " })
  await setup.waitFor(
    () =>
      setup.renderer.currentFocusedEditor instanceof TextareaRenderable &&
      setup.renderer.currentFocusedEditor !== editor,
  )
  await setup.mockInput.typeText("separate answer")
  expect(setup.composer.current()).toEqual(draft)
  setup.mockInput.pressEnter()
  expect(await answer).toBe("form: separate answer")
  expect(setup.composer.current()).toEqual(draft)
})

test("selected route changes never expose another mounted tab or a stale home draft", async () => {
  await using setup = await mountComposer({ config: { tabs: { enabled: true } } })
  await setup.waitFor(() => setup.composer.current().status === "ready")
  await setup.mockInput.typeText("home")
  setup.context.ui.router.navigate({ type: "session", sessionID: "ses_observation_a" })
  await setup.waitFor(() => {
    const value = setup.composer.current()
    return value.status === "ready" && value.sessionID === "ses_observation_a"
  })
  await setup.mockInput.typeText("alpha")
  setup.context.ui.router.navigate({ type: "session", sessionID: "ses_observation_b" })
  await setup.waitFor(() => {
    const value = setup.composer.current()
    return value.status === "ready" && value.sessionID === "ses_observation_b"
  })
  expect(setup.composer.current()).toMatchObject({ sessionID: "ses_observation_b", draft: { text: "" } })
  expect(setup.context.ui.tabs.focus("ses_observation_a")).toBe(true)
  await setup.waitFor(() => {
    const value = setup.composer.current()
    return value.status === "ready" && value.sessionID === "ses_observation_a" && value.draft.text === "alpha"
  })
  setup.context.ui.router.navigate({ type: "plugin", name: "observation" })
  expect(setup.composer.current()).toEqual({ status: "unavailable", reason: "not-selected" })
  setup.context.ui.router.navigate({ type: "home" })
  await setup.waitFor(() => setup.composer.current().status === "ready")
  expect(setup.composer.current()).toMatchObject({ sessionID: null, draft: { text: "home" } })
})

test("startup draft becomes ready only after the final composer adopts its native selection", async () => {
  await using setup = await mountComposer({
    startup: { text: "startup中", caret: 7, anchor: 9, touched: true, submit: false },
  })
  const values: ComposerObservation[] = []
  const stop = setup.composer.subscribe((value) => values.push(value))
  await setup.waitFor(() => {
    const value = setup.composer.current()
    return value.status === "ready" && value.draft.selection.anchor !== value.draft.caret
  })
  expect(setup.composer.current()).toMatchObject({
    kind: "final",
    sessionID: null,
    draft: { text: "startup中", caret: 7, selection: { anchor: 9, focus: 7 } },
  })
  expect(
    setup.changes
      .filter((value) => value.status === "ready")
      .every(
        (value) =>
          value.kind === "final" &&
          value.draft.text === "startup中" &&
          value.draft.caret === 7 &&
          value.draft.selection.anchor === 9,
      ),
  ).toBe(true)
  stop()
})

test("TUI disposal ends subscription delivery and makes retained observations explicitly disposed", async () => {
  const setup = await mountComposer()
  const values: ComposerObservation[] = []
  setup.composer.subscribe((value) => values.push(value))
  await setup[Symbol.asyncDispose]()
  const count = values.length
  expect(setup.composer.current()).toEqual({ status: "unavailable", reason: "disposed" })
  const stop = setup.composer.subscribe((value) => values.push(value))
  expect(values).toHaveLength(count + 1)
  expect(values.at(-1)).toEqual({ status: "unavailable", reason: "disposed" })
  stop()
  stop()
})
