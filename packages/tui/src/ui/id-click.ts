import { TextareaRenderable } from "@opentui/core"
import type { TuiClickEvent, TuiClickHandler } from "@opencode-ai/plugin/tui"

// IDs are clickable wherever they are drawn: session and message IDs in
// message footers and the sidebar, and any ID in what the AI and tools wrote.
// The ID is read back from the cells on screen, inside the renderable that was
// clicked, so it is found the way it reads, after markdown concealment and
// syntax colouring, and never runs into the next column. Prompt text is left
// to the caret.

const PATTERN = /^(ses|msg)_[0-9A-Za-z]{10,}$/
const KINDS = { ses: "session", msg: "message" } as const
// Any other prefixed ID: a part, a permission, a plugin's own. Every one
// opencode mints starts its body with a hex timestamp, which is what tells
// `prt_13b3002ef001…` from a snake_case word like `tool_name`.
const PREFIXED = /^[a-z]{2,6}_[0-9a-f]{4}[0-9A-Za-z]{4,}$/
// A provider's tool call ID has no prefix of its own, so it counts only after
// a label naming it: `callID: "toolu_…"`.
const CALL_LABEL = /(?:\b|_)call_?id"?\s*[:=]\s*"?$/i
// What a git commit hash looks like: 7 to 40 lowercase hex with a digit and a
// letter, so a number or a word made of hex letters (`defaced`) is not one.
// Whether it names a commit is the plugin's question; opencode never copies it.
const COMMIT = /^(?=[0-9a-f]*[a-f])(?=[0-9a-f]*[0-9])[0-9a-f]{7,40}$/

type Cells = { width: number; height: number; buffers: { char: Uint32Array } }
type Area = { x: number; y: number; width: number; height: number }
type Target = Area & { parent: Target | null }

// Renderables that draw IDs about the open session itself rather than IDs
// someone wrote: message footers and the sidebar's session ID.
const own = new WeakSet<object>()
export const markOwnIds = (renderable: object) => void own.add(renderable)

// What a row shows between two columns, one character per cell. Cells that
// are not a single code point (wide-character halves, graphemes) read as U+FFFD,
// so a column is still its index.
export function cellText(cells: Cells, y: number, left: number, right: number) {
  const from = Math.max(0, left)
  const to = Math.min(cells.width, right)
  if (y < 0 || y >= cells.height || to <= from) return ""
  return Array.from({ length: to - from }, (_, index) => {
    const code = cells.buffers.char[y * cells.width + from + index]
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd"
  }).join("")
}

export function idAt(cells: Cells, x: number, y: number, area?: Area) {
  const top = Math.max(0, area?.y ?? 0)
  const bottom = Math.min(cells.height, area ? area.y + area.height : cells.height)
  const left = Math.max(0, area?.x ?? 0)
  const right = Math.min(cells.width, area ? area.x + area.width : cells.width)
  if (y < top || y >= bottom || x < left || x >= right) return
  const at = (column: number) => cells.buffers.char[y * cells.width + column]
  if (!word(at(x))) return
  const start = scan(x, -1, (column) => column >= left && word(at(column))) + 1
  const end = scan(x, 1, (column) => column < right && word(at(column)))
  const value = String.fromCharCode(...Array.from({ length: end - start }, (_, index) => at(start + index)))
  const match = PATTERN.exec(value)
  if (match) return { kind: KINDS[match[1] as keyof typeof KINDS], value }
  const before = cellText(cells, y, left, start)
  if (PREFIXED.test(value) || (value.length >= 8 && CALL_LABEL.test(before))) return { kind: "id" as const, value, before }
  if (COMMIT.test(value)) return { kind: "commit" as const, value }
}

// The ID under a click, if any. Element handlers that act on a click call this
// first and stand down, so one click on an ID never also opens or toggles what
// contains it.
export function idUnder(cells: Cells, event: { x: number; y: number; target: Target | null }) {
  const target = event.target
  if (!target || target instanceof TextareaRenderable) return
  const found = idAt(cells, event.x, event.y, target)
  if (!found) return
  return { ...found, own: owned(target) }
}

// Plugins that act on a clicked ID, most recently added first. The first that
// returns true takes the click; when none does, opencode copies the ID.
export function createIdClick() {
  const handlers: TuiClickHandler[] = []
  return {
    on(handler: TuiClickHandler) {
      handlers.push(handler)
      return () => {
        const index = handlers.indexOf(handler)
        if (index >= 0) handlers.splice(index, 1)
      }
    },
    run(event: TuiClickEvent) {
      return handlers.toReversed().some((handler) => {
        try {
          return handler(event) === true
        } catch (error) {
          console.error("TUI click handler failed", error)
          return false
        }
      })
    },
  }
}

export type IdClick = ReturnType<typeof createIdClick>

function owned(target: Target | null): boolean {
  if (!target) return false
  return own.has(target) || owned(target.parent)
}

function scan(from: number, step: number, inside: (column: number) => boolean): number {
  const next = from + step
  return inside(next) ? scan(next, step, inside) : next
}

// ASCII letters, digits and underscore. Cells holding wide or combined
// characters carry flag bits above the code point and end the word.
function word(code: number | undefined) {
  if (code === undefined) return false
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95
}
