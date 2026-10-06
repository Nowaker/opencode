import type { TextareaRenderable } from "@opentui/core"
import { mentionTriggerIndex } from "./display"

// Finds the nearest "@" before the cursor with no whitespace between. A trigger holds no
// whitespace so it never crosses a newline, and reading just the current line out of the
// rope keeps a keystroke off the whole-buffer path.
export function mentionTriggerOffset(input: TextareaRenderable) {
  const offset = input.cursorOffset
  const lineStart = input.editBuffer.positionToOffset(input.logicalCursor.row, 0)
  const idx = mentionTriggerIndex(input.getTextRange(lineStart, offset), offset - lineStart)
  return idx === undefined ? undefined : lineStart + idx
}
