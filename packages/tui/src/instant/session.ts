export * as InstantSession from "./session"

import { TuiLayout } from "../layout"
import { InstantCache } from "./cache"
import type { InstantConfig } from "./config"
import { InstantEditor } from "./editor"
import { InstantFrame } from "./frame"
import { InstantKeys } from "./keys"

// The instant startup prompt's state and input handling, without any process
// I/O, so the same code runs in the worker thread that serves the prompt while
// the CLI loads and on the main thread once the TUI's renderer owns stdin.

export type Init = {
  screen: boolean
  config: InstantConfig.Settings
  cache?: InstantCache.Data
  entry?: InstantCache.Directory
  session?: InstantFrame.SessionView
  cwd: string
  home: string
  version: string
  placeholder: number
}

// Set when Enter was pressed while loading: the agent, model and variant the
// screen showed then (undefined when it showed none).
export type Queued = { selection?: InstantCache.Selection }

export type State = {
  text: string
  caret: number
  anchor?: number
  scroll: number
  spinner: number
  queued?: Queued
}

export type Mouse = Extract<InstantKeys.Event, { type: "mouse" }>

const CURSOR_STYLES = { block: 2, underline: 4, line: 6 } as const
const MOUSE_ON = "\x1b[?1000h\x1b[?1002h\x1b[?1006h"
const MOUSE_OFF = "\x1b[?1006l\x1b[?1002l\x1b[?1000l"
const KEYS_ON = "\x1b[?2004h\x1b[>1u\x1b[>4;1m"
const KEYS_OFF = "\x1b[?2004l\x1b[<u\x1b[>4m"

// Terminal modes the screen turns on: the alternate screen, bracketed paste,
// kitty and xterm key disambiguation, SGR mouse reports, the cursor shape and
// color. modesOff() undoes all but the alternate screen, leave() all of it.
export function enter(init: Init) {
  const cursor = init.config.cursor ?? { style: "block", blinking: true }
  const shape = cursor.style === "default" ? "" : `\x1b[${CURSOR_STYLES[cursor.style] - (cursor.blinking ? 1 : 0)} q`
  const color = init.cache?.theme?.text ? `\x1b]12;${init.cache.theme.text.slice(0, 7)}\x07` : ""
  return "\x1b[?1049h" + KEYS_ON + (init.config.mouse ? MOUSE_ON : "") + shape + color
}

export const modesOff = () => MOUSE_OFF + KEYS_OFF
export const leave = () => MOUSE_OFF + KEYS_OFF + "\x1b[0 q\x1b]112\x07\x1b[?1049l\x1b[?25h"

export function create(init: Init, state?: State) {
  const editor = InstantEditor.create({ text: state?.text, caret: state?.caret, anchor: state?.anchor })
  const bindings = InstantEditor.bindings(init.config.keybinds)
  let parser = InstantKeys.createParser()
  let scroll = state?.scroll ?? 0
  let spinner = state?.spinner ?? 0
  let queued = state?.queued
  let press: number | undefined
  let frame: InstantFrame.Output | undefined

  // The session's own prompt when it is cached, else the directory's.
  const selected = () => (init.session?.entry?.agent ? init.session.entry : init.entry)

  const shortcuts = () => {
    if (init.cache?.shortcuts) return init.cache.shortcuts
    const first = (name: string, fallback: string) => {
      const value = init.config.keybinds[name]
      return typeof value === "string" && value !== "none" ? value.split(",")[0].trim() : fallback
    }
    return { agents: first("agent_cycle", "tab"), commands: first("command_list", "ctrl+p") }
  }

  // The renderer asks for a frame on every spinner tick; the grid is rebuilt
  // only after an edit or a resize, otherwise just the spinner cells change.
  let dirty = true
  function compute(width: number, height: number): InstantFrame.Output {
    if (frame && !dirty && frame.grid.length === height && frame.grid[0]?.length === width) {
      const glyph = TuiLayout.Spinner.frames[spinner % TuiLayout.Spinner.frames.length]
      for (const at of frame.spinner) frame.grid[at.y][at.x].ch = glyph
      return frame
    }
    dirty = false
    const next = InstantFrame.render({
      width,
      height,
      config: init.config,
      theme: init.cache?.theme,
      entry: init.entry,
      session: init.session,
      shortcuts: shortcuts(),
      cwd: init.cwd,
      home: init.home,
      version: init.version,
      editor,
      placeholder: init.session
        ? ""
        : TuiLayout.promptPlaceholder("normal", TuiLayout.HomePlaceholders.normal[init.placeholder]),
      scroll,
      queued: !!queued,
      spinner,
    })
    const caretRow = next.cursor.y - next.text.y
    if (caretRow >= 0 && caretRow < next.text.rows) return (frame = next)
    scroll = Math.max(0, next.text.scroll + caretRow - (caretRow < 0 ? 0 : next.text.rows - 1))
    dirty = true
    return compute(width, height)
  }

  const cursorTo = (output: InstantFrame.Output) => `\x1b[${output.cursor.y + 1};${output.cursor.x + 1}H`

  // Returns "quit" when the key asks to leave opencode.
  function handle(event: InstantKeys.Event, backlog: boolean): "quit" | undefined {
    dirty = true
    const width = frame?.text.width ?? 80
    if (event.type === "text") return void editor.insert(event.text)
    if (event.type === "paste") return void editor.insert(event.text.replace(/\r\n?/g, "\n"))
    if (event.type === "mouse") return void pointer(event)
    const key = event.key
    // The tty turns an Enter typed before raw mode into a line feed (ICRNL),
    // while raw mode delivers Enter as a carriage return. A line feed in the
    // first read is therefore that early Enter, and it is dropped rather than
    // read as a newline; a carriage return is a real Enter.
    if (backlog && key.name === "j" && key.ctrl) return
    if (key.name === "escape") {
      queued = undefined
      return
    }
    if ((key.name === "c" || key.name === "d") && key.ctrl && !editor.text) return "quit"
    const action = InstantEditor.match(bindings, key)
    if (!action) return
    if (action === "submit") {
      if (init.screen && editor.text.trim()) queued = { selection: InstantCache.selection(selected()) }
      return
    }
    if (action === "clear") return void editor.clear()
    editor.apply(action, width)
  }

  function pointer(event: Mouse) {
    dirty = true
    const text = frame?.text
    if (!text || event.button !== 0) return
    if (event.action === "release") {
      press = undefined
      return
    }
    // Keys earlier in the same read may have changed the text since the last
    // frame, so the click is mapped onto the text as it is now.
    const lines = InstantEditor.layout(editor.text, text.width)
    const row = event.y - text.y + text.scroll
    const col = Math.max(0, event.x - text.x)
    if (event.action === "press") {
      if (event.y < text.y || event.y >= text.y + text.rows) return
      editor.click(lines, row, col)
      press = editor.caret
      return
    }
    if (event.action === "drag" && press !== undefined) editor.select(press, InstantEditor.offsetAt(lines, row, col))
  }

  return {
    init,
    editor,
    get queued() {
      return queued
    },
    // Feeds raw input; a lone Escape stays pending until flushEscape().
    input(bytes: Uint8Array, backlog = false) {
      for (const event of parser.feed(bytes)) if (handle(event, backlog) === "quit") return "quit" as const
    },
    escapePending() {
      return parser.pending() === "\x1b"
    },
    flushEscape() {
      for (const event of parser.flush()) if (handle(event, false) === "quit") return "quit" as const
    },
    // Input read but not yet turned into keys; the parser starts over.
    takePending() {
      const pending = parser.pending()
      parser = InstantKeys.createParser()
      return pending
    },
    paste(text: string) {
      handle({ type: "paste", text }, false)
    },
    pointer,
    compute,
    paint(width: number, height: number) {
      const output = compute(width, height)
      return "\x1b[?2026h\x1b[?25l" + InstantFrame.serialize(output.grid) + cursorTo(output) + "\x1b[?25h\x1b[?2026l"
    },
    tick() {
      spinner++
      if (!frame) return ""
      return "\x1b[?2026h" + InstantFrame.spinnerFrame(frame, spinner) + cursorTo(frame) + "\x1b[?2026l"
    },
    state(): State {
      return { text: editor.text, caret: editor.caret, anchor: editor.anchor, scroll, spinner, queued }
    },
  }
}

export type Session = ReturnType<typeof create>
