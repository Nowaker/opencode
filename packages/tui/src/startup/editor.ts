export * as StartupEditor from "./editor"

import { action, type Action } from "./bindings"
import type { Key } from "./input"
import {
  layout,
  lineEnd,
  lineStart,
  locate,
  next,
  offsetAt,
  previous,
  wordBackward,
  wordForward,
  type Measure,
} from "./layout"

// The startup composer's editing model: plain text with a UTF-16 caret and an optional selection anchor, always on
// grapheme boundaries. It follows the full prompt's default input bindings; the renderer converts these offsets to its
// own edit-buffer offsets when it takes the draft over.

export type Snapshot = {
  readonly text: string
  readonly caret: number
  /** Where a selection started; equal to `caret` when nothing is selected. */
  readonly anchor: number
  /** Whether any editing key changed the draft or caret since startup. */
  readonly touched: boolean
  /** Enter was pressed and nothing changed the text since. */
  readonly submit: boolean
}

type Draft = { text: string; caret: number; anchor: number }

export function create(input: { text?: string; measure: Measure }) {
  const initial = input.text ?? ""
  let state: Draft = { text: initial, caret: initial.length, anchor: initial.length }
  let touched = false
  let revision = 0
  let submitted: number | undefined
  const undo: Draft[] = []
  const redo: Draft[] = []
  const measure = input.measure

  const selection = () =>
    state.anchor === state.caret
      ? undefined
      : { start: Math.min(state.anchor, state.caret), end: Math.max(state.anchor, state.caret) }

  const edit = (text: string, caret: number) => {
    if (text === state.text && caret === state.caret && state.anchor === caret) return
    undo.push(state)
    redo.length = 0
    state = { text, caret, anchor: caret }
    revision++
  }

  const replace = (start: number, end: number, insert: string) =>
    edit(state.text.slice(0, start) + insert + state.text.slice(end), start + insert.length)

  const deleteRange = (start: number, end: number) => {
    const range = selection()
    if (range) return replace(range.start, range.end, "")
    if (start === end) return
    replace(Math.min(start, end), Math.max(start, end), "")
  }

  const move = (caret: number, select: boolean) => {
    state = { ...state, caret, anchor: select ? state.anchor : caret }
  }

  const collapse = (edge: "start" | "end") => {
    const range = selection()
    if (!range) return false
    move(range[edge], false)
    return true
  }

  const vertical = (direction: -1 | 1, columns: number, select: boolean) => {
    const lines = layout(state.text, columns, measure)
    const at = locate(lines, state.caret)
    const target = lines[at.row + direction]
    if (!target) return move(direction < 0 ? 0 : state.text.length, select)
    move(offsetAt(target, at.col), select)
  }

  const visualEdge = (edge: "home" | "end", columns: number, select: boolean) => {
    const lines = layout(state.text, columns, measure)
    const line = locate(lines, state.caret).line
    move(edge === "home" ? line.start : (line.cells.at(-1)?.end ?? line.start), select)
  }

  const run: Record<Exclude<Action, "quit">, (columns: number) => void> = {
    submit: () => {
      submitted = revision
    },
    newline: () => insert("\n"),
    move_left: () => collapse("start") || move(previous(state.text, state.caret), false),
    move_right: () => collapse("end") || move(next(state.text, state.caret), false),
    move_up: (columns) => vertical(-1, columns, false),
    move_down: (columns) => vertical(1, columns, false),
    select_left: () => move(previous(state.text, state.caret), true),
    select_right: () => move(next(state.text, state.caret), true),
    select_up: (columns) => vertical(-1, columns, true),
    select_down: (columns) => vertical(1, columns, true),
    line_home: () => move(lineStart(state.text, state.caret), false),
    line_end: () => move(lineEnd(state.text, state.caret), false),
    select_line_home: () => move(lineStart(state.text, state.caret), true),
    select_line_end: () => move(lineEnd(state.text, state.caret), true),
    visual_line_home: (columns) => visualEdge("home", columns, false),
    visual_line_end: (columns) => visualEdge("end", columns, false),
    select_visual_line_home: (columns) => visualEdge("home", columns, true),
    select_visual_line_end: (columns) => visualEdge("end", columns, true),
    select_buffer_home: () => move(0, true),
    select_buffer_end: () => move(state.text.length, true),
    delete_line: () => {
      const start = lineStart(state.text, state.caret)
      const end = lineEnd(state.text, state.caret)
      if (end < state.text.length) return replace(start, end + 1, "")
      replace(start > 0 ? start - 1 : start, end, "")
    },
    delete_to_line_end: () => {
      const end = lineEnd(state.text, state.caret)
      deleteRange(state.caret, end === state.caret ? Math.min(state.text.length, end + 1) : end)
    },
    delete_to_line_start: () => {
      const start = lineStart(state.text, state.caret)
      deleteRange(start === state.caret ? Math.max(0, start - 1) : start, state.caret)
    },
    backspace: () => deleteRange(previous(state.text, state.caret), state.caret),
    delete: () => deleteRange(state.caret, next(state.text, state.caret)),
    undo: () => {
      const last = undo.pop()
      if (!last) return
      redo.push(state)
      state = last
      revision++
    },
    redo: () => {
      const last = redo.pop()
      if (!last) return
      undo.push(state)
      state = last
      revision++
    },
    word_forward: () => move(wordForward(state.text, state.caret), false),
    word_backward: () => move(wordBackward(state.text, state.caret), false),
    select_word_forward: () => move(wordForward(state.text, state.caret), true),
    select_word_backward: () => move(wordBackward(state.text, state.caret), true),
    delete_word_forward: () => deleteRange(state.caret, wordForward(state.text, state.caret)),
    delete_word_backward: () => deleteRange(wordBackward(state.text, state.caret), state.caret),
    select_all: () => {
      state = { ...state, anchor: 0, caret: state.text.length }
    },
  }

  function insert(text: string) {
    if (!text) return
    const range = selection()
    if (range) return replace(range.start, range.end, text)
    replace(state.caret, state.caret, text)
  }

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
    /** Applies a key; returns the action it ran, if any. */
    key(key: Key, columns: number): Action | undefined {
      const name = action(key)
      if (!name) {
        if (key.ctrl || key.alt || key.super || key.name.length === 0) return
        if ([...key.name].length !== 1 && key.name !== "space") return
        touched = true
        insert(key.name === "space" ? " " : key.shift ? key.name.toUpperCase() : key.name)
        return
      }
      if (name === "quit") return name
      touched = true
      run[name](columns)
      return name
    },
    insert(text: string) {
      touched = true
      insert(text)
    },
    paste(text: string) {
      touched = true
      insert(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"))
    },
    snapshot(): Snapshot {
      return { text: state.text, caret: state.caret, anchor: state.anchor, touched, submit: submitted === revision }
    },
  }
}

export type Editor = ReturnType<typeof create>
