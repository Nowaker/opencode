import { TextareaRenderable, type Selection } from "@opentui/core"
import { extend } from "@opentui/solid"
import { markdownNewline } from "../../util/markdown-continuation"

export class PromptTextareaRenderable extends TextareaRenderable {
  private selectionAnchor = 0
  private selecting = false

  protected override updateSelectionForMovement(select: boolean, before: boolean) {
    if (!this.selectable || !select) return super.updateSelectionForMovement(select, before)

    const offset = this.cursorOffset
    if (before) {
      const selection = this.getSelection()
      this.selectionAnchor = selection ? (offset === selection.start ? selection.end : selection.start) : offset
    }

    this.selecting = true
    super.updateSelectionForMovement(select, before)
    this.selecting = false
  }

  override onSelectionChanged(selection: Selection | null) {
    if (!selection) this.editorView.resetSelection()
    if (!this.selecting || !selection) return super.onSelectionChanged(selection)

    // Keep renderer ownership for copy/dismiss, but use caret boundaries instead of mouse cells.
    this.lastLocalSelection = null
    this.editorView.resetLocalSelection()
    const offset = this.cursorOffset
    if (this.selectionAnchor === offset) {
      this.editorView.resetSelection()
      this.requestRender()
      return false
    }

    this.editorView.setSelection(
      Math.min(this.selectionAnchor, offset),
      Math.max(this.selectionAnchor, offset),
      this.selectionBg,
      this.selectionFg,
    )
    this.requestRender()
    return this.hasSelection()
  }

  // A newline continues a Markdown list or closes a code fence (`util/markdown-continuation`). The edit goes
  // through insertText and character deletes, never a whole-text replace, so prompt-part extmarks stay where they are.
  override newLine() {
    if (this.hasSelection()) return super.newLine()
    const before = this.getTextRange(0, this.cursorOffset)
    const after = this.plainText.slice(before.length)
    const next = markdownNewline(before + after, before.length)
    if (next.text.startsWith(before) && next.text.endsWith(after)) {
      const inserted = next.text.slice(before.length, next.text.length - after.length)
      if (inserted === "\n") return super.newLine()
      this.insertText(inserted)
      for (let back = inserted.length - (next.cursor - before.length); back > 0; back--) this.moveCursorLeft()
      return true
    }
    // An empty list item: the marker goes and no line is added, which ends the list.
    const line = before.slice(before.lastIndexOf("\n") + 1) + after.split("\n", 1)[0]
    // OpenTUI 0.4.5 loses the caret when a backward delete empties the last line, so the line is first joined to
    // the one above, its marker deleted forward, and the newline put back.
    const row = this.logicalCursor.row
    this.setCursor(row, 0)
    if (row > 0) this.deleteCharBackward()
    for (let left = line.length; left > 0; left--) this.deleteChar()
    if (row > 0) super.newLine()
    return true
  }

  override moveCursorRight(options?: { select?: boolean }) {
    const selection = this.getSelection()
    if (options?.select || this.lastLocalSelection || !selection) return super.moveCursorRight(options)

    // OpenTUI 0.4.5 subtracts a mouse cell when collapsing a backward selection.
    this.cursorOffset = selection.end
    this.clearSelection()
    return true
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    prompt_textarea: typeof PromptTextareaRenderable
  }
}

extend({ prompt_textarea: PromptTextareaRenderable })
