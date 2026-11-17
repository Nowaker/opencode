import assert from "node:assert/strict"
import { beforeEach, expect, test } from "bun:test"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { composerEditor, mountComposer } from "./fixture/composer"
import { selectBeforeLayout, shiftedKeys } from "./fixture/composer-selection"

beforeEach(() => takeDraft(undefined))

test("decoded stepwise ShiftLeft selects only the crossed cells with a fixed boundary anchor", async () => {
  await using setup = await mountComposer()
  await setup.waitFor(() => setup.composer.current().status === "ready")
  await setup.mockInput.typeText("w15-draft-12345678")
  await setup.renderOnce()
  const editor = composerEditor(setup)
  const read = () => ({ caret: editor.cursorOffset, range: editor.getSelection() })
  expect(read()).toEqual({ caret: 18, range: null })
  setup.renderer.stdin.emit("data", Buffer.from("\x1b[D"))
  expect(read()).toEqual({ caret: 17, range: null })
  setup.renderer.stdin.emit("data", Buffer.from("\x1b[D"))
  expect(read()).toEqual({ caret: 16, range: null })
  setup.renderer.stdin.emit("data", Buffer.from("\x1b[1;2D"))
  const first = { native: read(), observed: setup.composer.current() }
  setup.renderer.stdin.emit("data", Buffer.from("\x1b[1;2D"))
  const second = { native: read(), observed: setup.composer.current() }
  expect([first.native, second.native]).toEqual([
    { caret: 15, range: { start: 15, end: 16 } },
    { caret: 14, range: { start: 14, end: 16 } },
  ])
  expect(first.observed).toMatchObject({ draft: { caret: 15, selection: { anchor: 16, focus: 15 } } })
  expect(second.observed).toMatchObject({ draft: { caret: 14, selection: { anchor: 16, focus: 14 } } })
})

test.each([
  { width: 44, pauseMidChunk: false },
  { width: 100, pauseMidChunk: false },
  { width: 100, pauseMidChunk: true },
])(
  "pre-layout input remains owned when admitted ($width columns, dispatched chunk: $pauseMidChunk)",
  async (scenario) => {
    await using setup = await mountComposer()
    setup.resize(scenario.width, 35)
    await setup.waitFor(() => setup.composer.current().status === "ready")
    setup.context.ui.router.navigate({ type: "session", sessionID: "ses_observation_a" })
    await setup.waitFor(() => {
      const value = setup.composer.current()
      return value.status === "ready" && value.sessionID === "ses_observation_a"
    })
    const pasted = Promise.withResolvers<void>()
    const stop = setup.composer.subscribe((value) => {
      if (value.status === "ready" && value.draft.pasted.length === 1) pasted.resolve()
    })
    await setup.mockInput.pasteBracketedText("fixture line one\nfixture line two\nfixture line three")
    await pasted.promise
    stop()
    const saved = setup.composer.current()
    assert.equal(saved.status, "ready")
    setup.context.ui.router.navigate({ type: "home" })
    await setup.waitFor(() => {
      const value = setup.composer.current()
      return value.status === "ready" && value.sessionID === null
    })
    const editor = await selectBeforeLayout(setup)
    expect({ text: editor.plainText, caret: editor.cursorOffset, range: editor.getSelection() }).toEqual({
      text: "[Pasted ~3 lines] ",
      caret: 18,
      range: null,
    })
    using decoded = shiftedKeys(setup)
    let ownsPause = false
    const pause = () => {
      setup.renderer.stdin.pause()
      ownsPause = true
    }
    if (scenario.pauseMidChunk) setup.renderer.keyInput.prependOnceListener("keypress", pause)
    try {
      const burst = Buffer.from(" amark 日本 ab\x1b[1;2D\x1b[1;2D")
      setup.renderer.stdin.push(burst)
      const pending = {
        observed: setup.composer.current(),
        text: editor.plainText,
        caret: editor.cursorOffset,
        range: editor.getSelection(),
      }
      await setup.renderOnce()
      await decoded.done
      expect(pending).toEqual({
        observed: { status: "unavailable", reason: "not-mounted" },
        text: "[Pasted ~3 lines] ",
        caret: 18,
        range: null,
      })
      expect({ text: editor.plainText, caret: editor.cursorOffset, range: editor.getSelection() }).toEqual({
        text: "[Pasted ~3 lines]  amark 日本 ab",
        caret: 30,
        range: { start: 30, end: 32 },
      })
      expect(setup.renderer.stdin.isPaused()).toBe(scenario.pauseMidChunk)
      expect(setup.composer.current()).toMatchObject({
        sessionID: "ses_observation_a",
        draft: { caret: 30, selection: { anchor: 32, focus: 30 }, pasted: saved.draft.pasted },
      })
    } finally {
      setup.renderer.keyInput.off("keypress", pause)
      if (ownsPause) setup.renderer.stdin.resume()
    }
  },
)

test("the exact ready-driven paste and unsplit text-plus-selection burst use the admitted native editor", async () => {
  await using setup = await mountComposer()
  await setup.waitFor(() => setup.composer.current().status === "ready")
  setup.context.ui.router.navigate({ type: "session", sessionID: "ses_observation_a" })
  await setup.waitFor(() => {
    const value = setup.composer.current()
    return value.status === "ready" && value.sessionID === "ses_observation_a"
  })
  const editor = composerEditor(setup)
  expect(editor.width > 0 && editor.height > 0).toBe(true)
  const pasted = Promise.withResolvers<void>()
  const stop = setup.composer.subscribe((value) => {
    if (value.status === "ready" && value.draft.pasted.length === 1) pasted.resolve()
  })
  setup.renderer.stdin.push(Buffer.from("\x1b[200~fixture line one\nfixture line two\nfixture line three\x1b[201~"))
  await pasted.promise
  stop()
  expect({ text: editor.plainText, caret: editor.cursorOffset }).toEqual({ text: "[Pasted ~3 lines] ", caret: 18 })
  using decoded = shiftedKeys(setup)
  setup.renderer.stdin.push(Buffer.from(" amark 日本 ab\x1b[1;2D\x1b[1;2D"))
  await decoded.done
  expect({ text: editor.plainText, caret: editor.cursorOffset, range: editor.getSelection() }).toEqual({
    text: "[Pasted ~3 lines]  amark 日本 ab",
    caret: 30,
    range: { start: 30, end: 32 },
  })
  expect(setup.composer.current()).toMatchObject({ draft: { caret: 30, selection: { anchor: 32, focus: 30 } } })
})
