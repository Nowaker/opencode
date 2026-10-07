export * as InstantCaret from "./caret"

type Textarea = {
  cursorOffset: number
  getTextRange(start: number, end: number): string
  setSelection(start: number, end: number): void
  gotoBufferEnd(): void
}

// opentui addresses the caret in display cells while the instant prompt keeps
// UTF-16 offsets into the text; the cell for an offset is the last one whose
// preceding text is no longer than it, so a wide glyph is never split.
export function cell(area: Textarea, offset: number) {
  area.gotoBufferEnd()
  let low = 0
  let high = area.cursorOffset
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (area.getTextRange(0, middle).length <= offset) low = middle
    else high = middle - 1
  }
  return low
}

export function place(area: Textarea, caret: number, selection?: { start: number; end: number }) {
  const start = selection ? cell(area, selection.start) : 0
  const end = selection ? cell(area, selection.end) : 0
  area.cursorOffset = cell(area, caret)
  if (selection) area.setSelection(start, end)
}
