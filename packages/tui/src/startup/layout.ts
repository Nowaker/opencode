export * as StartupLayout from "./layout"

// Word-wrapped layout of the startup editor's text. Offsets are UTF-16 indexes into the text; every cell is one
// grapheme. Control characters are kept in the text and drawn as visible symbols, so pasted escape sequences can
// never reach the terminal as control output.

export type Cell = {
  readonly offset: number
  readonly end: number
  readonly col: number
  readonly width: number
  readonly text: string
}
export type Line = { readonly start: number; readonly end: number; readonly cells: readonly Cell[] }
/** Laid-out text always has a line, even when empty. */
export type Lines = [Line, ...Line[]]
export type Measure = (segment: string) => number

let segmenter: Intl.Segmenter | undefined

export function graphemes(text: string, from = 0, to = text.length) {
  const slice = text.slice(from, to)
  if (/^[\x20-\x7e]*$/.test(slice)) return Array.from(slice, (segment, index) => ({ segment, index: from + index }))
  segmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" })
  return Array.from(segmenter.segment(slice), (item) => ({ segment: item.segment, index: from + item.index }))
}

/** What a grapheme looks like on screen: control characters become Unicode control pictures. */
export function display(segment: string) {
  if (segment === "\t") return "  "
  const code = segment.codePointAt(0) ?? 0
  if (segment.length === 1 && code < 0x20) return String.fromCodePoint(0x2400 + code)
  if (code === 0x7f) return "\u2421"
  if (code >= 0x80 && code <= 0x9f) return "\ufffd"
  return segment
}

function width(segment: string, measure: Measure) {
  const shown = display(segment)
  if (shown !== segment) return shown === "  " ? 2 : 1
  if (segment.length === 1 && segment >= " " && segment <= "~") return 1
  return Math.max(0, measure(segment))
}

export function layout(text: string, columns: number, measure: Measure): Lines {
  const max = Math.max(1, columns)
  const first = lineEnd(text, 0)
  const lines = wrap(text, 0, first, max, measure)
  for (let start = first + 1; start <= text.length; start = lineEnd(text, start) + 1)
    lines.push(...wrap(text, start, lineEnd(text, start), max, measure))
  return lines
}

// One logical line into visual lines: a line breaks after the last whitespace that fits, or at the width when a word
// has no break opportunity.
function wrap(text: string, start: number, end: number, max: number, measure: Measure): Lines {
  const lines: Line[] = []
  let cells: Cell[] = []
  let col = 0
  let rowStart = start
  let lastBreak = -1
  for (const { segment, index } of graphemes(text, start, end)) {
    const cellWidth = width(segment, measure)
    if (col + cellWidth > max && cells.length > 0) {
      const split = lastBreak >= 0 ? lastBreak + 1 : cells.length
      const head = cells.slice(0, split)
      const tail = cells.slice(split)
      const tailStart = tail[0]?.offset ?? index
      lines.push({ start: rowStart, end: tailStart, cells: head })
      rowStart = tailStart
      cells = tail.reduce<Cell[]>((result, cell) => {
        const previous = result.at(-1)
        result.push({ ...cell, col: previous ? previous.col + previous.width : 0 })
        return result
      }, [])
      col = cells.reduce((total, cell) => total + cell.width, 0)
      lastBreak = cells.findLastIndex((cell) => /\s/.test(cell.text))
    }
    cells.push({ offset: index, end: index + segment.length, col, width: cellWidth, text: segment })
    col += cellWidth
    if (/\s/.test(segment)) lastBreak = cells.length - 1
  }
  const last = { start: rowStart, end, cells }
  const [top, ...rest] = lines
  return top ? [top, ...rest, last] : [last]
}

/** The visual row and column of a caret offset. A caret at a wrap point belongs to the following line. */
export function locate(lines: Lines, offset: number) {
  const found = lines.findIndex((line, index) => {
    const next = lines[index + 1]
    if (offset < line.start) return false
    if (next && next.start === line.end && offset >= next.start && next.start !== next.end) return false
    return offset <= line.end
  })
  const row = Math.max(0, found)
  // An offset past every line belongs to the first, as findIndex reports none.
  const line = lines[row] ?? lines[0]
  const cell = line.cells.find((item) => item.offset >= offset)
  const col = cell ? cell.col : line.cells.reduce((total, item) => total + item.width, 0)
  return { row, col, line }
}

/** The caret offset nearest to a visual column on a row. */
export function offsetAt(line: Line, col: number) {
  const cell = line.cells.find((item) => item.col + item.width / 2 > col)
  return cell ? cell.offset : line.end
}

// Caret motion on grapheme boundaries. A line break is its own step; word motion skips non-word graphemes first.

export function lineStart(text: string, offset: number) {
  return text.lastIndexOf("\n", offset - 1) + 1
}

export function lineEnd(text: string, offset: number) {
  const end = text.indexOf("\n", offset)
  return end < 0 ? text.length : end
}

export function previous(text: string, offset: number) {
  if (offset <= 0) return 0
  if (text[offset - 1] === "\n") return offset - 1
  const parts = graphemes(text, lineStart(text, offset), offset)
  return parts.at(-1)?.index ?? offset - 1
}

export function next(text: string, offset: number) {
  if (offset >= text.length) return text.length
  if (text[offset] === "\n") return offset + 1
  const parts = graphemes(text, offset, lineEnd(text, offset))
  const first = parts[0]
  return first ? first.index + first.segment.length : offset + 1
}

const WORD = /[\p{L}\p{N}_]/u

export function wordForward(text: string, offset: number) {
  let index = offset
  while (index < text.length && !WORD.test(text.charAt(index))) index = next(text, index)
  while (index < text.length && WORD.test(text.charAt(index))) index = next(text, index)
  return index
}

export function wordBackward(text: string, offset: number) {
  let index = offset
  while (index > 0 && !WORD.test(text.charAt(previous(text, index)))) index = previous(text, index)
  while (index > 0 && WORD.test(text.charAt(previous(text, index)))) index = previous(text, index)
  return index
}
