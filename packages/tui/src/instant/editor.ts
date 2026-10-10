export * as InstantEditor from "./editor"

import { Definitions } from "../config/keybind-definitions"
import type { InstantKeys } from "./keys"

// The instant startup prompt's text field: a plain string with a caret and an
// optional selection anchor, both UTF-16 offsets, edited by the same input_*
// keybinds as the real prompt and laid out with the same word wrap opentui
// uses, so text, caret and selection carry over to the real textarea intact.

export type Action =
  | "submit"
  | "newline"
  | "clear"
  | "move_left"
  | "move_right"
  | "move_up"
  | "move_down"
  | "select_left"
  | "select_right"
  | "select_up"
  | "select_down"
  | "line_home"
  | "line_end"
  | "select_line_home"
  | "select_line_end"
  | "visual_line_home"
  | "visual_line_end"
  | "select_visual_line_home"
  | "select_visual_line_end"
  | "buffer_home"
  | "buffer_end"
  | "select_buffer_home"
  | "select_buffer_end"
  | "delete_line"
  | "delete_to_line_end"
  | "delete_to_line_start"
  | "backspace"
  | "delete"
  | "undo"
  | "redo"
  | "word_forward"
  | "word_backward"
  | "select_word_forward"
  | "select_word_backward"
  | "delete_word_forward"
  | "delete_word_backward"
  | "select_all"

const KEYBIND_ACTIONS = {
  input_submit: "submit",
  input_newline: "newline",
  input_clear: "clear",
  input_move_left: "move_left",
  input_move_right: "move_right",
  input_move_up: "move_up",
  input_move_down: "move_down",
  input_select_left: "select_left",
  input_select_right: "select_right",
  input_select_up: "select_up",
  input_select_down: "select_down",
  input_line_home: "line_home",
  input_line_end: "line_end",
  input_select_line_home: "select_line_home",
  input_select_line_end: "select_line_end",
  input_visual_line_home: "visual_line_home",
  input_visual_line_end: "visual_line_end",
  input_select_visual_line_home: "select_visual_line_home",
  input_select_visual_line_end: "select_visual_line_end",
  input_buffer_home: "buffer_home",
  input_buffer_end: "buffer_end",
  input_select_buffer_home: "select_buffer_home",
  input_select_buffer_end: "select_buffer_end",
  input_delete_line: "delete_line",
  input_delete_to_line_end: "delete_to_line_end",
  input_delete_to_line_start: "delete_to_line_start",
  input_backspace: "backspace",
  input_delete: "delete",
  input_undo: "undo",
  input_redo: "redo",
  input_word_forward: "word_forward",
  input_word_backward: "word_backward",
  input_select_word_forward: "select_word_forward",
  input_select_word_backward: "select_word_backward",
  input_delete_word_forward: "delete_word_forward",
  input_delete_word_backward: "delete_word_backward",
  input_select_all: "select_all",
} satisfies Partial<Record<keyof typeof Definitions, Action>>

export type Binding = { action: Action; key: InstantKeys.Key }

const MODIFIER_ALIASES: Record<string, "ctrl" | "alt" | "shift" | "super"> = {
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  meta: "alt",
  option: "alt",
  shift: "shift",
  super: "super",
  cmd: "super",
}
const NAME_ALIASES: Record<string, string> = { enter: "return", esc: "escape", del: "delete" }

// One binding spec, as keybind.ts accepts it, to the strokes it names. Leader
// chords never apply to the text field and are skipped.
export function parseBinding(value: unknown): InstantKeys.Key[] {
  if (value === false || value === "none" || value === undefined || value === null) return []
  if (Array.isArray(value)) return value.flatMap(parseBinding)
  if (typeof value === "object") {
    if ("key" in value) return parseBinding(value.key)
    if ("name" in value && typeof value.name === "string") {
      const stroke = value as Partial<InstantKeys.Key> & { meta?: boolean }
      return [
        {
          name: stroke.name!,
          ctrl: !!stroke.ctrl,
          alt: !!stroke.alt || !!stroke.meta,
          shift: !!stroke.shift,
          super: !!stroke.super,
        },
      ]
    }
    return []
  }
  if (typeof value !== "string") return []
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item && !item.includes("<leader>"))
    .flatMap((item) => {
      const parts = item.length > 1 && item.endsWith("+") ? [...item.slice(0, -2).split("+"), "+"] : item.split("+")
      const name = parts.pop()!
      const stroke: InstantKeys.Key = {
        name: NAME_ALIASES[name] ?? name,
        ctrl: false,
        alt: false,
        shift: false,
        super: false,
      }
      for (const part of parts) {
        const modifier = MODIFIER_ALIASES[part]
        if (!modifier) return []
        stroke[modifier] = true
      }
      return [stroke]
    })
}

export function bindings(overrides: Record<string, unknown> = {}): Binding[] {
  return Object.entries(KEYBIND_ACTIONS).flatMap(([name, action]) =>
    parseBinding(name in overrides ? overrides[name] : Definitions[name as keyof typeof KEYBIND_ACTIONS].default).map(
      (key) => ({ action, key }),
    ),
  )
}

export function sameKey(a: InstantKeys.Key, b: InstantKeys.Key) {
  return a.name === b.name && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.super === b.super
}

export function match(table: Binding[], key: InstantKeys.Key): Action | undefined {
  return table.find((binding) => sameKey(binding.key, key))?.action
}

export type Cell = { offset: number; end: number; col: number; width: number; text: string }
export type Line = { start: number; end: number; cells: Cell[] }

const BREAK_AFTER = new Set([..."/\\.,;:-()[]{}!?"])
let segmenter: Intl.Segmenter | undefined

function graphemes(text: string, from: number, to: number) {
  const slice = text.slice(from, to)
  // ASCII needs no segmentation, which keeps keystrokes cheap in the common case.
  if (/^[\x20-\x7e]*$/.test(slice)) return Array.from(slice, (char, index) => ({ segment: char, index: from + index }))
  segmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" })
  return Array.from(segmenter.segment(slice), (item) => ({ segment: item.segment, index: from + item.index }))
}

function cellWidth(segment: string) {
  if (segment === "\t") return 2
  if (segment.length === 1 && segment >= " " && segment <= "~") return 1
  return Bun.stringWidth(segment)
}

// Word wrap as opentui's "word" mode does it: a line may break after
// whitespace or after one of BREAK_AFTER; trailing whitespace that fits stays
// on the line, and a run with no break opportunity is cut at the width.
export function layout(text: string, width: number): Line[] {
  const max = Math.max(1, width)
  const lines: Line[] = []
  let start = 0
  while (true) {
    const newline = text.indexOf("\n", start)
    const end = newline < 0 ? text.length : newline
    let cells: Cell[] = []
    let col = 0
    let lastBreak = -1
    for (const { segment, index } of graphemes(text, start, end)) {
      const w = cellWidth(segment)
      if (col + w > max && cells.length > 0) {
        const cut = lastBreak >= 0 ? lastBreak + 1 : cells.length
        const kept = cells.slice(0, cut)
        lines.push({ start: kept[0].offset, end: cells[cut]?.offset ?? index, cells: kept })
        const rest = cells.slice(cut)
        const shift = rest[0]?.col ?? 0
        cells = rest.map((cell) => ({ ...cell, col: cell.col - shift }))
        col = cells.reduce((sum, cell) => sum + cell.width, 0)
        lastBreak = cells.findLastIndex((cell) => /\s/.test(cell.text) || BREAK_AFTER.has(cell.text))
      }
      cells.push({ offset: index, end: index + segment.length, col, width: w, text: segment })
      col += w
      if (/\s/.test(segment) || BREAK_AFTER.has(segment)) lastBreak = cells.length - 1
    }
    lines.push({ start: cells[0]?.offset ?? start, end, cells })
    if (newline < 0) return lines
    start = newline + 1
  }
}

export function caretPosition(lines: Line[], caret: number) {
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row]
    const next = lines[row + 1]
    if (caret < line.start) continue
    if (caret > line.end) continue
    // A caret on a wrap boundary belongs to the start of the following row.
    if (caret === line.end && next && next.start === line.end) continue
    const cell = line.cells.find((item) => item.offset >= caret)
    if (cell) return { row, col: cell.col }
    const last = line.cells[line.cells.length - 1]
    return { row, col: last ? last.col + last.width : 0 }
  }
  const row = lines.length - 1
  const last = lines[row].cells[lines[row].cells.length - 1]
  return { row, col: last ? last.col + last.width : 0 }
}

export function offsetAt(lines: Line[], row: number, col: number) {
  const line = lines[Math.max(0, Math.min(lines.length - 1, row))]
  const cell = line.cells.find((item) => col < item.col + item.width)
  if (cell) return cell.offset
  const next = lines[lines.indexOf(line) + 1]
  // Past the end of a wrapped row the caret stays on that row, before its last cell.
  if (next && next.start === line.end && line.cells.length) return line.cells[line.cells.length - 1].offset
  return line.end
}

export type Snapshot = { text: string; caret: number; anchor?: number }

const isSeparator = (char: string) => /\s/.test(char) || BREAK_AFTER.has(char)

export function create(input: Partial<Snapshot> = {}) {
  const state: Snapshot & { goal?: number } = { text: input.text ?? "", caret: input.caret ?? 0, anchor: input.anchor }
  const undo: Snapshot[] = []
  const redo: Snapshot[] = []
  let typing = false

  const snapshot = (): Snapshot => ({ text: state.text, caret: state.caret, anchor: state.anchor })
  const restore = (value: Snapshot) => Object.assign(state, value, { goal: undefined })
  // opentui keeps the anchor's own cell selected when the caret moves back
  // past it, so a backward selection reaches one cell further than the anchor.
  const selection = () => {
    if (state.anchor === undefined || state.anchor === state.caret) return
    if (state.caret > state.anchor) return { start: state.anchor, end: state.caret }
    return { start: state.caret, end: Math.min(state.text.length, nextBoundary(state.anchor)) }
  }

  function record(coalesce = false) {
    if (coalesce && typing) return
    undo.push(snapshot())
    if (undo.length > 200) undo.shift()
    redo.length = 0
    typing = coalesce
  }

  function replace(start: number, end: number, text: string, coalesce = false) {
    record(coalesce)
    state.text = state.text.slice(0, start) + text + state.text.slice(end)
    state.caret = start + text.length
    state.anchor = undefined
    state.goal = undefined
  }

  function deleteRange(start: number, end: number) {
    const selected = selection()
    if (selected) return replace(selected.start, selected.end, "")
    if (start === end) return
    replace(Math.min(start, end), Math.max(start, end), "")
  }

  function previousBoundary(offset: number) {
    if (offset <= 0) return 0
    const lineStart = state.text.lastIndexOf("\n", offset - 1) + 1
    if (lineStart === offset) return offset - 1
    const cells = graphemes(state.text, lineStart, offset)
    return cells[cells.length - 1].index
  }

  function nextBoundary(offset: number) {
    if (offset >= state.text.length) return state.text.length
    if (state.text[offset] === "\n") return offset + 1
    const lineEnd = state.text.indexOf("\n", offset)
    const cells = graphemes(state.text, offset, lineEnd < 0 ? state.text.length : lineEnd)
    return cells[1]?.index ?? (lineEnd < 0 ? state.text.length : lineEnd)
  }

  // Word motion as opentui does it: forward lands just past the next
  // separator, backward just past the previous one, and a newline is its own
  // stop (backward stops before it, at the end of the previous line).
  function wordForward(offset: number) {
    if (state.text[offset] === "\n") return offset + 1
    for (let index = offset + 1; index < state.text.length; index++) {
      if (isSeparator(state.text[index])) return index + 1
    }
    return state.text.length
  }

  function wordBackward(offset: number) {
    if (offset > 0 && state.text[offset - 1] === "\n") return offset - 1
    for (let index = offset - 2; index >= 0; index--) {
      if (isSeparator(state.text[index])) return state.text[index] === "\n" ? index : index + 1
    }
    return 0
  }

  const lineStart = (offset: number) => state.text.lastIndexOf("\n", offset - 1) + 1
  const lineEnd = (offset: number) => {
    const index = state.text.indexOf("\n", offset)
    return index < 0 ? state.text.length : index
  }

  function move(to: number, select: boolean, keepGoal = false) {
    typing = false
    if (select) state.anchor ??= state.caret
    if (!select) state.anchor = undefined
    state.caret = Math.max(0, Math.min(state.text.length, to))
    if (!keepGoal) state.goal = undefined
  }

  function vertical(direction: -1 | 1, width: number, select: boolean) {
    const lines = layout(state.text, width)
    const position = caretPosition(lines, state.caret)
    state.goal ??= position.col
    const row = position.row + direction
    if (row < 0 || row >= lines.length) return
    move(offsetAt(lines, row, state.goal), select, true)
  }

  function visualLine(width: number) {
    const lines = layout(state.text, width)
    const row = caretPosition(lines, state.caret).row
    const line = lines[row]
    const wrapped = lines[row + 1]?.start === line.end && line.cells.length > 0
    return { start: line.start, end: wrapped ? line.cells[line.cells.length - 1].offset : line.end }
  }

  // At a line's edge, line home/end step across the newline to the
  // neighbouring line, as opentui's gotoLineHome/gotoLineEnd do.
  return {
    get text() {
      return state.text
    },
    get caret() {
      return state.caret
    },
    get anchor() {
      return state.anchor
    },
    selection,
    snapshot,
    insert(text: string) {
      if (!text) return
      const selected = selection()
      if (selected) return replace(selected.start, selected.end, text)
      replace(state.caret, state.caret, text, !text.includes("\n") && text.length === 1)
    },
    clear() {
      if (state.text) replace(0, state.text.length, "")
    },
    click(lines: Line[], row: number, col: number, extend = false) {
      move(offsetAt(lines, row, col), extend)
    },
    select(start: number, end: number) {
      typing = false
      state.anchor = start
      state.caret = end
      state.goal = undefined
    },
    // Applies an editing action. "submit" and "clear" are the caller's
    // business and are not handled here.
    apply(action: Action, width: number) {
      const selected = selection()
      switch (action) {
        case "newline":
          return this.insert("\n")
        case "move_left":
          return move(selected ? selected.start : previousBoundary(state.caret), false)
        case "move_right":
          return move(selected ? selected.end : nextBoundary(state.caret), false)
        case "select_left":
          return move(previousBoundary(state.caret), true)
        case "select_right":
          return move(nextBoundary(state.caret), true)
        case "move_up":
          return vertical(-1, width, false)
        case "move_down":
          return vertical(1, width, false)
        case "select_up":
          return vertical(-1, width, true)
        case "select_down":
          return vertical(1, width, true)
        case "line_home":
          return move(lineStart(state.caret), false)
        case "line_end":
          return move(lineEnd(state.caret), false)
        case "select_line_home":
          return move(lineStart(state.caret), true)
        case "select_line_end":
          return move(lineEnd(state.caret), true)
        case "visual_line_home":
          return move(visualLine(width).start, false)
        case "visual_line_end":
          return move(visualLine(width).end, false)
        case "select_visual_line_home":
          return move(visualLine(width).start, true)
        case "select_visual_line_end":
          return move(visualLine(width).end, true)
        case "buffer_home":
          return move(0, false)
        case "buffer_end":
          return move(state.text.length, false)
        case "select_buffer_home":
          return move(0, true)
        case "select_buffer_end":
          return move(state.text.length, true)
        case "select_all":
          state.anchor = 0
          return move(state.text.length, true)
        case "delete_line": {
          const start = lineStart(state.caret)
          const end = lineEnd(state.caret)
          if (end < state.text.length) return replace(start, end + 1, "")
          return replace(Math.max(0, start - (start > 0 ? 1 : 0)), end, "")
        }
        // Neither deletes across a line end, except that opentui never leaves
        // an emptied last line behind: its preceding newline goes with it.
        case "delete_to_line_end": {
          const start = lineStart(state.caret)
          const end = lineEnd(state.caret)
          if (end === state.caret) return
          if (start === state.caret && start > 0 && end === state.text.length) return replace(start - 1, end, "")
          return replace(state.caret, end, "")
        }
        case "delete_to_line_start": {
          const start = lineStart(state.caret)
          if (start === state.caret) return start > 0 ? replace(start - 1, start, "") : undefined
          if (state.caret === state.text.length && start > 0) return replace(start - 1, state.caret, "")
          return replace(start, state.caret, "")
        }
        case "backspace":
          return deleteRange(previousBoundary(state.caret), state.caret)
        case "delete":
          return deleteRange(state.caret, nextBoundary(state.caret))
        case "word_forward":
          return move(wordForward(state.caret), false)
        case "word_backward":
          return move(wordBackward(state.caret), false)
        case "select_word_forward":
          return move(wordForward(state.caret), true)
        case "select_word_backward":
          return move(wordBackward(state.caret), true)
        case "delete_word_forward":
          return deleteRange(state.caret, wordForward(state.caret))
        case "delete_word_backward":
          return deleteRange(wordBackward(state.caret), state.caret)
        case "undo": {
          const previous = undo.pop()
          if (!previous) return
          redo.push(snapshot())
          typing = false
          return restore(previous)
        }
        case "redo": {
          const next = redo.pop()
          if (!next) return
          undo.push(snapshot())
          typing = false
          return restore(next)
        }
      }
    },
  }
}

export type Editor = ReturnType<typeof create>
