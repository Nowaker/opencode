export * as StartupBindings from "./bindings"

import type { Key } from "./input"

// Which editing action a startup key runs.

export type Action =
  | "submit"
  | "newline"
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
  | "quit"

// The defaults of the full prompt's input.* keybinds (src/config/keybind.ts), plus Home/End and Ctrl+C.
const BINDINGS: ReadonlyArray<readonly [Action, string]> = [
  ["submit", "return"],
  ["newline", "shift+return,ctrl+return,alt+return,ctrl+j"],
  ["move_left", "left,ctrl+b"],
  ["move_right", "right,ctrl+f"],
  ["move_up", "up"],
  ["move_down", "down"],
  ["select_left", "shift+left"],
  ["select_right", "shift+right"],
  ["select_up", "shift+up"],
  ["select_down", "shift+down"],
  ["line_home", "ctrl+a,home"],
  ["line_end", "ctrl+e,end"],
  ["select_line_home", "ctrl+shift+a"],
  ["select_line_end", "ctrl+shift+e"],
  ["visual_line_home", "alt+a"],
  ["visual_line_end", "alt+e"],
  ["select_visual_line_home", "alt+shift+a"],
  ["select_visual_line_end", "alt+shift+e"],
  ["select_buffer_home", "shift+home"],
  ["select_buffer_end", "shift+end"],
  ["delete_line", "ctrl+shift+d"],
  ["delete_to_line_end", "ctrl+k"],
  ["delete_to_line_start", "ctrl+u"],
  ["backspace", "backspace,shift+backspace"],
  ["delete", "ctrl+d,delete,shift+delete"],
  ["undo", "ctrl+-,super+z"],
  ["redo", "ctrl+.,super+shift+z"],
  ["word_forward", "alt+f,alt+right,ctrl+right"],
  ["word_backward", "alt+b,alt+left,ctrl+left"],
  ["select_word_forward", "alt+shift+f,alt+shift+right"],
  ["select_word_backward", "alt+shift+b,alt+shift+left"],
  ["delete_word_forward", "alt+d,alt+delete,ctrl+delete"],
  ["delete_word_backward", "ctrl+w,ctrl+backspace,alt+backspace"],
  ["select_all", "super+a"],
  ["quit", "ctrl+c"],
]

const TABLE = new Map(
  BINDINGS.flatMap(([action, spec]) =>
    spec.split(",").flatMap((stroke) => {
      const parts = stroke.split("+")
      const name = parts.pop()
      return name ? [[identity({ name, ...flags(parts) }), action] as const] : []
    }),
  ),
)

function flags(parts: string[]) {
  return {
    ctrl: parts.includes("ctrl"),
    alt: parts.includes("alt"),
    shift: parts.includes("shift"),
    super: parts.includes("super"),
  }
}

function identity(key: Key) {
  return [key.ctrl && "ctrl", key.alt && "alt", key.shift && "shift", key.super && "super", key.name]
    .filter(Boolean)
    .join("+")
}

export function action(key: Key): Action | undefined {
  return TABLE.get(identity(key))
}
