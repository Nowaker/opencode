export * as StartupFrame from "./frame"

import { logo } from "../logo"
import { display, layout, locate, type Measure } from "./layout"

// Complete fullscreen frames for the startup composer. Each frame repaints every row inside a synchronized update,
// so a frame interrupted by the handover never leaves half a screen behind. Text is drawn through `display`, which
// turns control characters into visible symbols.

export type Route = "home" | "session"

export type Input = {
  readonly route: Route
  readonly width: number
  readonly height: number
  readonly text: string
  readonly caret: number
  readonly anchor: number
  readonly status?: string
  readonly version?: string
  readonly measure: Measure
}

// Only the modes the startup tokenizer understands: the alternate screen, bracketed paste and the kitty keyboard's
// disambiguation flag. The renderer pushes its own keyboard flags, so the startup flags are popped before it starts.
export const enter = "\x1b[?1049h\x1b[?2004h\x1b[>1u"
export const relinquish = "\x1b[<u\x1b[?2004l"
export const leave = "\x1b[<u\x1b[?2004l\x1b[0m\x1b[?25h\x1b[?1049l"

const PLACEHOLDER = "Ask anything…"
const LOGO = logo.left.map((left, index) => `${left} ${logo.right[index]}`.replace(/[_,]/g, " ").replace(/[\^~]/g, "▀"))

/** The composer's box width and its text columns at a terminal width. */
export function geometry(route: Route, width: number) {
  const box = route === "home" ? Math.max(8, Math.min(75, width - (width < 44 ? 2 : 4))) : Math.max(8, width - 4)
  return { box, columns: Math.max(1, box - 5) }
}

export function render(input: Input) {
  const width = Math.max(1, input.width)
  const height = Math.max(1, input.height)
  const home = input.route === "home"
  const shape = geometry(input.route, width)
  const box = shape.box
  const columns = shape.columns
  const left = home ? Math.max(0, Math.floor((width - box) / 2)) : Math.min(2, Math.max(0, width - box))
  const lines = layout(input.text, columns, input.measure)
  const caret = locate(lines, input.caret)
  const maxRows = Math.max(1, height - (home ? 14 : 6))
  const first = Math.max(0, Math.min(caret.row - maxRows + 1, lines.length - maxRows))
  const visible = lines.slice(first, first + maxRows)
  const composer = visible.length + 4
  const logoHeight = home && height >= composer + 9 ? LOGO.length + 1 : 0
  const block = logoHeight + composer + 1
  const top = home ? Math.max(0, Math.floor((height - block) / 2)) : Math.max(0, height - composer - 1)
  const start = Math.min(input.anchor, input.caret)
  const end = Math.max(input.anchor, input.caret)
  const rows = new Map<number, string>()
  const put = (row: number, col: number, text: string) => {
    if (row < 0 || row >= height) return
    rows.set(row, (rows.get(row) ?? "") + `\x1b[${row + 1};${col + 1}H${text}`)
  }

  if (logoHeight)
    LOGO.forEach((line, index) => put(top + index, Math.max(0, Math.floor((width - line.length) / 2)), line))
  const composerTop = top + logoHeight
  put(composerTop, left, "┃")
  visible.forEach((line, index) => {
    const cells = line.cells
      .map((cell) => {
        const text = display(cell.text)
        return cell.offset >= start && cell.offset < end ? `\x1b[7m${text}\x1b[27m` : text
      })
      .join("")
    put(composerTop + 1 + index, left, `┃  ${cells}`)
  })
  if (!input.text) put(composerTop + 1, left, `┃  \x1b[2m${PLACEHOLDER}\x1b[22m`)
  put(composerTop + 1 + visible.length, left, "┃")
  put(composerTop + 2 + visible.length, left, `┃  \x1b[2m${clip(input.status ?? "", columns)}\x1b[22m`)
  put(composerTop + 3 + visible.length, left, `╹${"▀".repeat(Math.max(0, box - 1))}`)
  if (home && input.version) put(height - 2, Math.max(0, width - input.version.length - 2), input.version)

  const body = Array.from({ length: height }, (_, row) => `\x1b[${row + 1};1H\x1b[2K${rows.get(row) ?? ""}`).join("")
  const caretRow = composerTop + 1 + caret.row - first
  const caretCol = left + 3 + caret.col
  return `\x1b[?2026h\x1b[?25l\x1b[0m${body}\x1b[${caretRow + 1};${Math.min(width, caretCol + 1)}H\x1b[?25h\x1b[?2026l`
}

function clip(text: string, columns: number) {
  const shown = Array.from(text, display).join("")
  return shown.length > columns ? shown.slice(0, Math.max(0, columns - 1)) + "…" : shown
}
