import { beforeEach, expect, test } from "bun:test"
import assert from "node:assert/strict"
import { InputRenderable } from "@opentui/core"
import { onMount } from "solid-js"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { mountComposer } from "./fixture/composer"
import { selectBeforeLayout } from "./fixture/composer-selection"

beforeEach(() => takeDraft(undefined))

test("pre-layout native paste and following keys replay in their original order exactly once", async () => {
  await using setup = await mountComposer()
  await setup.waitFor(() => setup.composer.current().status === "ready")
  const input = await selectBeforeLayout(setup)
  const applied = Promise.withResolvers<void>()
  const stop = setup.composer.subscribe((value) => {
    if (
      value.status === "ready" &&
      value.sessionID === "ses_observation_a" &&
      value.draft.caret === 30 &&
      value.draft.text.endsWith(" amark 日本 ab")
    )
      applied.resolve()
  })
  setup.renderer.stdin.push(
    Buffer.from(
      "\x1b[200~fixture line one\nfixture line two\nfixture line three\x1b[201~ amark 日本 ab\x1b[1;2D\x1b[1;2D",
    ),
  )
  expect(input.plainText).toBe("")
  await setup.renderOnce()
  await applied.promise
  stop()
  expect({ text: input.plainText, caret: input.cursorOffset, range: input.getSelection() }).toEqual({
    text: "[Pasted ~3 lines]  amark 日本 ab",
    caret: 30,
    range: { start: 30, end: 32 },
  })
  expect(setup.composer.current()).toMatchObject({
    draft: {
      selection: { anchor: 32, focus: 30 },
      pasted: [
        {
          text: "fixture line one\nfixture line two\nfixture line three",
          source: { start: 0, end: 17, text: "[Pasted ~3 lines]" },
        },
      ],
    },
  })
})

test("a form focused before admission receives only its own input and preserves the final owner's pending keys", async () => {
  await using setup = await mountComposer()
  await setup.waitFor(() => setup.composer.current().status === "ready")
  const input = await selectBeforeLayout(setup)
  const applied = Promise.withResolvers<void>()
  const stop = setup.composer.subscribe((value) => {
    if (value.status === "ready" && value.sessionID === "ses_observation_a" && value.draft.text === "owned ")
      applied.resolve()
  })
  setup.renderer.stdin.push(Buffer.from("owned "))
  const result = setup.context.ui.dialog.prompt({ title: "Admission form", value: "form: " })
  await setup.renderOnce()
  await setup.mockInput.typeText("answer")
  setup.mockInput.pressEnter()
  expect(await result).toBe("form: answer")
  await applied.promise
  stop()
  expect({ text: input.plainText, caret: input.cursorOffset }).toEqual({ text: "owned ", caret: 6 })
})

test("pre-layout mixed RTL and CJK input retains native display offsets without conversion", async () => {
  await using setup = await mountComposer()
  await setup.waitFor(() => setup.composer.current().status === "ready")
  const input = await selectBeforeLayout(setup)
  const applied = Promise.withResolvers<void>()
  const stop = setup.composer.subscribe((value) => {
    if (value.status === "ready" && value.draft.text === "אבג 日本 ab" && value.draft.caret === 9) applied.resolve()
  })
  setup.renderer.stdin.push(Buffer.from("אבג 日本 ab\x1b[1;2D\x1b[1;2D"))
  await setup.renderOnce()
  await applied.promise
  stop()
  expect({ text: input.plainText, caret: input.cursorOffset, range: input.getSelection() }).toEqual({
    text: "אבג 日本 ab",
    caret: 9,
    range: { start: 9, end: 11 },
  })
  expect(setup.composer.current()).toMatchObject({ draft: { selection: { anchor: 11, focus: 9 } } })
})

test("native admission keeps focus with a foreign editor until the final composer is selected", async () => {
  await using setup = await mountComposer()
  await setup.waitFor(() => setup.composer.current().status === "ready")
  const input = await selectBeforeLayout(setup)
  setup.renderer.stdin.push(Buffer.from("owned "))
  let foreign: InputRenderable | undefined
  const mounted = Promise.withResolvers<void>()
  const remove = setup.context.ui.slot({
    append: "app",
    render: () => {
      onMount(() => {
        foreign?.focus()
        mounted.resolve()
      })
      return (
        <input
          ref={(value: InputRenderable) => {
            foreign = value
          }}
          width={20}
        />
      )
    },
  })
  await mounted.promise
  assert.ok(foreign)
  await setup.mockInput.typeText("form-only")
  await setup.renderOnce()
  expect(setup.renderer.currentFocusedEditor === foreign).toBe(true)
  expect(foreign.value).toBe("form-only")
  expect(input.plainText).toBe("")
  remove()
  input.focus()
  expect(input.plainText).toBe("owned ")
})
