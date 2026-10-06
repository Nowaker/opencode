/** @jsxImportSource @opentui/solid */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test"
import type { TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { mentionTriggerOffset } from "../../src/prompt/mention"
import { promptOffsetWidth } from "../../src/prompt/display"

// A large CJK buffer has no printable-ASCII run for the display arithmetic to skip, so a
// lookup that walks the whole buffer segments every grapheme on every keystroke.
const cjkLine = "敏捷的棕色狐狸跳过了那只懒狗并且一直不停地奔跑下去\n"
const largeCjk = cjkLine.repeat(Math.ceil(100_000 / cjkLine.length)).slice(0, 100_000)

let app: Awaited<ReturnType<typeof testRender>>
let input: TextareaRenderable

beforeAll(async () => {
  const textarea = Promise.withResolvers<TextareaRenderable>()
  app = await testRender(
    () => (
      <box width="100%">
        <textarea width="100%" maxHeight={12} ref={textarea.resolve} />
      </box>
    ),
    { width: 100, height: 24 },
  )
  await app.flush()
  input = await textarea.promise
})

afterAll(() => app.renderer.destroy())

function edit(text: string) {
  input.setText(text)
  input.gotoBufferEnd()
}

describe("mention trigger lookup in the prompt editor", () => {
  test("finds the trigger on the cursor's line in display offsets of the whole buffer", () => {
    const before = "中文 @one\n👨‍👩‍👧‍👦 line\ncafe\u0301 "
    edit(`${before}@src/file`)

    expect(mentionTriggerOffset(input)).toBe(promptOffsetWidth(before))
  })

  test("does not carry a trigger across a line break", () => {
    edit("look at @src\n")

    expect(mentionTriggerOffset(input)).toBeUndefined()
  })

  test("uses the cursor position rather than the end of the buffer", () => {
    edit("first @one\nsecond @two")
    input.setCursor(0, "first @on".length)

    expect(mentionTriggerOffset(input)).toBe("first ".length)
  })

  test("reads only the cursor's line out of a 100 KB CJK prompt", () => {
    const before = `${largeCjk}see `
    const text = `${before}@src`
    edit(text)
    // Every read of the editor's text, plainText included, goes through these two.
    const reads = [spyOn(input.editBuffer, "getText"), spyOn(input.editBuffer, "getTextRange")]

    const offset = mentionTriggerOffset(input)
    const read = reads
      .flatMap((spy) => spy.mock.results)
      .reduce((total, result) => total + (result.type === "return" ? result.value.length : 0), 0)
    reads.forEach((spy) => spy.mockRestore())

    expect(offset).toBe(promptOffsetWidth(before))
    expect(read).toBeLessThanOrEqual(text.length - text.lastIndexOf("\n") - 1)
  })
})
