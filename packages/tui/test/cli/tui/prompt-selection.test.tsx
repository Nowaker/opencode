/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup } from "solid-js"
import { PromptTextareaRenderable } from "../../../src/component/prompt/textarea"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../../src/keymap"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

// The prompt's subclass and a stock textarea under the real opencode keymap: the stock one is the in-test witness
// of OpenTUI 0.4.5's two-cell keyboard selection, so the bug's reproduction never depends on a mutant.
async function mount() {
  const editors: { prompt?: TextareaRenderable; control?: TextareaRenderable } = {}
  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    onCleanup(registerOpencodeKeymap(keymap, renderer, createTuiResolvedConfig()))
    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <box flexDirection="column">
          <prompt_textarea ref={(editor) => (editors.prompt = editor)} width={60} height={3} />
          <textarea ref={(editor) => (editors.control = editor)} width={60} height={3} />
        </box>
      </OpencodeKeymapProvider>
    )
  }
  const app = await testRender(() => <Harness />, { width: 80, height: 12, kittyKeyboard: true })
  await app.renderOnce()
  if (!editors.prompt || !editors.control) throw new Error("both editors must mount")
  return { app, prompt: editors.prompt, control: editors.control }
}

test("prompt keyboard selection keeps its anchor at the original caret boundary", async () => {
  const { app, prompt, control } = await mount()
  try {
    const key = (sequence: string) => app.renderer.stdin.emit("data", Buffer.from(sequence))
    const read = (editor: TextareaRenderable) => ({
      caret: editor.cursorOffset,
      range: editor.getSelection(),
      text: editor.getSelectedText(),
    })
    const place = async (editor: TextareaRenderable, text: string, caret: number) => {
      app.renderer.clearSelection()
      editor.focus()
      editor.setText(text)
      editor.cursorOffset = caret
      await app.renderOnce()
    }

    expect(prompt.constructor.name, "the prompt editor is the boundary-selection subclass").toBe(
      "PromptTextareaRenderable",
    )
    expect(prompt).toBeInstanceOf(PromptTextareaRenderable)
    expect(control.constructor.name, "the control is a stock textarea").toBe("TextareaRenderable")

    await place(control, "w15-draft-12345678", 16)
    key("\x1b[1;2D")
    expect(read(control), "stock 0.4.5 no longer shows the two-cell selection").toEqual({
      caret: 15,
      range: { start: 15, end: 17 },
      text: "67",
    })

    await place(prompt, "w15-draft-12345678", 16)
    expect(app.renderer.currentFocusedEditor === prompt, "the prompt owns keyboard focus").toBe(true)
    key("\x1b[1;2D")
    expect(read(prompt), "first ShiftLeft selects only the crossed cell").toEqual({
      caret: 15,
      range: { start: 15, end: 16 },
      text: "6",
    })
    key("\x1b[1;2D")
    expect(read(prompt), "second ShiftLeft keeps the original caret boundary as anchor").toEqual({
      caret: 14,
      range: { start: 14, end: 16 },
      text: "56",
    })
    expect(app.renderer.getSelection()?.getSelectedText(), "the renderer selection carries the same text").toBe("56")
    key("\x1b[C")
    expect(read(prompt), "Right collapses to the exclusive end boundary").toEqual({ caret: 16, range: null, text: "" })

    for (const step of [
      { key: "\x1b[1;2C", caret: 17, range: { start: 16, end: 17 }, text: "7" },
      { key: "\x1b[1;2C", caret: 18, range: { start: 16, end: 18 }, text: "78" },
      { key: "\x1b[1;2D", caret: 17, range: { start: 16, end: 17 }, text: "7" },
      { key: "\x1b[1;2D", caret: 16, range: null, text: "" },
      { key: "\x1b[1;2D", caret: 15, range: { start: 15, end: 16 }, text: "6" },
    ]) {
      key(step.key)
      expect(read(prompt), "selection shrinks and crosses the anchor without selecting an extra cell").toEqual({
        caret: step.caret,
        range: step.range,
        text: step.text,
      })
    }

    for (const move of [
      { name: "word backward", plain: "\x1b[1;3D", select: "\x1b[1;4D" },
      { name: "word forward", plain: "\x1b[1;3C", select: "\x1b[1;4C" },
      { name: "line home", plain: "\x01", select: "\x1b[97;6u" },
      { name: "line end", plain: "\x05", select: "\x1b[101;6u" },
      { name: "buffer home", plain: "\x1b[H", select: "\x1b[1;2H" },
      { name: "buffer end", plain: "\x1b[F", select: "\x1b[1;2F" },
      { name: "up", plain: "\x1b[A", select: "\x1b[1;2A" },
      { name: "down", plain: "\x1b[B", select: "\x1b[1;2B" },
    ]) {
      await place(prompt, "one two\nthree four\nfive six", 10)
      key(move.plain)
      const caret = prompt.cursorOffset
      expect(caret, `${move.name} must move the caret`).not.toBe(10)
      await place(prompt, "one two\nthree four\nfive six", 10)
      key(move.select)
      expect(
        { caret: prompt.cursorOffset, range: prompt.getSelection() },
        `${move.name} selects exactly the interval crossed by the corresponding plain movement`,
      ).toEqual({ caret, range: { start: Math.min(10, caret), end: Math.max(10, caret) } })
    }
  } finally {
    app.renderer.destroy()
  }
})
