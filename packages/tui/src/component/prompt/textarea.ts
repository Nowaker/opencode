import { TextareaRenderable, type Selection } from "@opentui/core"
import { extend } from "@opentui/solid"

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
