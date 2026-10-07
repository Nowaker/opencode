import { createTestRenderer } from "@opentui/core/testing"
import { TextareaRenderable } from "@opentui/core"
import { InstantEditor } from "../../src/instant/editor"

// Runs one editing action through opentui's own textarea and through the
// instant prompt's editor, from the same text and caret, and reports both.
export async function createParity(width: number) {
  const setup = await createTestRenderer({ width: width + 10, height: 40 })
  const textarea = new TextareaRenderable(setup.renderer, { width, height: 30 })
  setup.renderer.root.add(textarea)
  await setup.renderOnce()

  const native: Record<Exclude<InstantEditor.Action, "submit" | "clear">, () => void> = {
    newline: () => textarea.newLine(),
    move_left: () => textarea.moveCursorLeft(),
    move_right: () => textarea.moveCursorRight(),
    move_up: () => textarea.moveCursorUp(),
    move_down: () => textarea.moveCursorDown(),
    select_left: () => textarea.moveCursorLeft({ select: true }),
    select_right: () => textarea.moveCursorRight({ select: true }),
    select_up: () => textarea.moveCursorUp({ select: true }),
    select_down: () => textarea.moveCursorDown({ select: true }),
    line_home: () => textarea.gotoLineHome(),
    line_end: () => textarea.gotoLineEnd(),
    select_line_home: () => textarea.gotoLineHome({ select: true }),
    select_line_end: () => textarea.gotoLineEnd({ select: true }),
    visual_line_home: () => textarea.gotoVisualLineHome(),
    visual_line_end: () => textarea.gotoVisualLineEnd(),
    select_visual_line_home: () => textarea.gotoVisualLineHome({ select: true }),
    select_visual_line_end: () => textarea.gotoVisualLineEnd({ select: true }),
    buffer_home: () => textarea.gotoBufferHome(),
    buffer_end: () => textarea.gotoBufferEnd(),
    select_buffer_home: () => textarea.gotoBufferHome({ select: true }),
    select_buffer_end: () => textarea.gotoBufferEnd({ select: true }),
    delete_line: () => textarea.deleteLine(),
    delete_to_line_end: () => textarea.deleteToLineEnd(),
    delete_to_line_start: () => textarea.deleteToLineStart(),
    backspace: () => textarea.deleteCharBackward(),
    delete: () => textarea.deleteChar(),
    undo: () => textarea.undo(),
    redo: () => textarea.redo(),
    word_forward: () => textarea.moveWordForward(),
    word_backward: () => textarea.moveWordBackward(),
    select_word_forward: () => textarea.moveWordForward({ select: true }),
    select_word_backward: () => textarea.moveWordBackward({ select: true }),
    delete_word_forward: () => textarea.deleteWordForward(),
    delete_word_backward: () => textarea.deleteWordBackward(),
    select_all: () => textarea.selectAll(),
  }

  return {
    textarea,
    async run(text: string, caret: number, action: keyof typeof native) {
      textarea.setText(text)
      textarea.clearSelection()
      textarea.cursorOffset = caret
      await setup.renderOnce()
      native[action]()
      await setup.renderOnce()
      const selection = textarea.getSelection()
      const expected = {
        text: textarea.plainText,
        caret: textarea.cursorOffset,
        selection: selection && selection.start !== selection.end ? [selection.start, selection.end] : undefined,
      }
      const editor = InstantEditor.create({ text, caret })
      editor.apply(action, width)
      const selected = editor.selection()
      const actual = {
        text: editor.text,
        caret: editor.caret,
        selection: selected ? [selected.start, selected.end] : undefined,
      }
      return { expected, actual }
    },
    async cursor(text: string, caret: number) {
      textarea.setText(text)
      textarea.cursorOffset = caret
      await setup.renderOnce()
      const visual = textarea.visualCursor
      return { row: visual.visualRow, col: visual.visualCol }
    },
    async lines(text: string) {
      textarea.setText(text)
      await setup.renderOnce()
      const frame = setup.captureCharFrame().split("\n")
      return frame.map((line) => line.slice(0, width).trimEnd())
    },
    destroy() {
      setup.renderer.destroy()
    },
  }
}
