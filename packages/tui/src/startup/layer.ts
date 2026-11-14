export * as StartupLayer from "./layer"

import {
  BoxRenderable,
  CliRenderer,
  CliRenderEvents,
  TextareaRenderable,
  type KeyEvent,
  type RGBA,
} from "@opentui/core"
import { destroyRenderer } from "../util/renderer"
import { StartupFrame } from "./frame"
import type { StartupInput } from "./index"

// The temporary native editor in the place the worker's frames drew it. It sits on an opaque fullscreen layer, as
// those frames did, so the application mounting underneath stays hidden until a composer claims the draft.
//
// OpenTUI keeps keyboard selections in screen coordinates, so a selection can only be restored once the receiving
// textarea has been laid out. Input stays paused from the moment the draft lands in a textarea until its selection
// is back, so no key can act on a half-restored selection.

export type Draft = {
  readonly text: string
  /** Edit-buffer offsets: cells plus line breaks, as the receiving textarea measures them. */
  readonly caret: number
  readonly anchor: number
}

/** Theme colors for the temporary editor, applied once the application's theme is known. */
export type Style = {
  readonly background: RGBA
  readonly panel: RGBA
  readonly border: RGBA
  readonly text: RGBA
  readonly placeholder: RGBA
}

export type Layer = ReturnType<typeof create>

/** Mounts the editor holding the worker's snapshot. `draft` is that snapshot in the textarea's own offsets. */
export function create(renderer: CliRenderer, route: StartupFrame.Route, snapshot: StartupInput.Snapshot) {
  const layer = new BoxRenderable(renderer, {
    id: "startup-layer",
    position: "absolute",
    zIndex: 6000,
    left: 0,
    top: 0,
    width: "100%",
    height: "100%",
  })
  const box = new BoxRenderable(renderer, {
    id: "startup-composer",
    position: "absolute",
    border: ["left"],
    customBorderChars: {
      topLeft: "┃",
      bottomLeft: "╹",
      vertical: "┃",
      topRight: "",
      bottomRight: "",
      horizontal: " ",
      bottomT: "",
      topT: "",
      cross: "",
      leftT: "",
      rightT: "",
    },
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 1,
    paddingBottom: 1,
    flexDirection: "column",
  })
  const textarea = new TextareaRenderable(renderer, {
    id: "startup-composer-input",
    width: "100%",
    minHeight: 1,
    maxHeight: 10,
    wrapMode: "word",
    placeholder: "Ask anything…",
  })
  textarea.onKeyDown = (key: KeyEvent) => {
    if (!key.ctrl || key.name !== "c" || key.shift || key.meta) return
    key.preventDefault()
    destroyRenderer(renderer)
  }
  box.add(textarea)
  layer.add(box)
  const place = () => {
    const width = renderer.width
    const shape = StartupFrame.geometry(route, width)
    box.width = shape.box
    box.left = route === "home" ? Math.max(0, Math.floor((width - shape.box) / 2)) : Math.min(2, width)
    if (route === "home") box.top = Math.max(0, Math.floor(renderer.height / 2) - 2)
    else box.bottom = 1
  }
  place()
  renderer.on(CliRenderEvents.RESIZE, place)
  renderer.root.add(layer)
  textarea.setText(snapshot.text)
  textarea.focus()
  const measure = (offset: number) => textarea.editBuffer.measureText(snapshot.text.slice(0, offset))
  const draft: Draft = { text: snapshot.text, caret: measure(snapshot.caret), anchor: measure(snapshot.anchor) }
  let last = draft
  let laidOut = false
  const ready = () => {
    laidOut = true
  }
  const capture = () => {
    if (!textarea.isDestroyed) last = read(textarea)
  }
  const prepare = () => {
    if (!laidOut || textarea.isDestroyed) return
    textarea.focus()
    if (renderer.getSelection()?.isDragging) return capture()
    const current = read(textarea)
    if (current.caret !== last.caret || current.anchor !== last.anchor) restoreNow(textarea, last)
  }
  // Global editing bindings can stop propagation before the textarea's own handlers. Bracket the complete public
  // dispatch so every key or paste edits once against the retained selection, then records its actual result.
  const keys = renderer.keyInput
  const key = keys.processParsedKey
  const paste = keys.processPaste
  const dispatchKey: typeof key = (event) => {
    prepare()
    try {
      return key.call(keys, event)
    } finally {
      capture()
    }
  }
  const dispatchPaste: typeof paste = (bytes, metadata) => {
    prepare()
    try {
      paste.call(keys, bytes, metadata)
    } finally {
      capture()
    }
  }
  keys.processParsedKey = dispatchKey
  keys.processPaste = dispatchPaste
  // Mouse selection precedes key dispatch inside the existing parser; repair before that parser sees the chunk.
  renderer.stdin.prependListener("data", prepare)
  renderer.once(CliRenderEvents.FRAME, ready)
  renderer.on(CliRenderEvents.SELECTION, capture)

  return {
    textarea,
    draft,
    read: () => last,
    /**
     * Moves the editor above a tree mounted after it. Solid replaces a root's first child when its top level
     * changes, which must never be this editor.
     */
    raise() {
      if (layer.isDestroyed || layer.parent !== renderer.root) return
      renderer.root.remove(layer)
      renderer.root.add(layer)
      textarea.focus()
    },
    style(colors: Style) {
      if (layer.isDestroyed) return
      layer.backgroundColor = colors.background
      box.backgroundColor = colors.panel
      box.borderColor = colors.border
      textarea.textColor = colors.text
      textarea.focusedTextColor = colors.text
      textarea.cursorColor = colors.text
      textarea.placeholderColor = colors.placeholder
    },
    destroy() {
      renderer.off(CliRenderEvents.RESIZE, place)
      renderer.stdin.off("data", prepare)
      renderer.off(CliRenderEvents.FRAME, ready)
      renderer.off(CliRenderEvents.SELECTION, capture)
      if (keys.processParsedKey === dispatchKey) keys.processParsedKey = key
      if (keys.processPaste === dispatchPaste) keys.processPaste = paste
      if (!layer.isDestroyed) layer.destroyRecursively()
    },
  }
}

function read(textarea: TextareaRenderable): Draft {
  const caret = textarea.cursorOffset
  const selection = textarea.getSelection()
  const anchor =
    !selection || selection.start === selection.end
      ? caret
      : caret === selection.start
        ? selection.end
        : selection.start
  return { text: textarea.plainText, caret, anchor }
}

// Puts the cursor and selection into a textarea that already holds the text. A selection is rebuilt by Shift-moving
// from its anchor after the next layout, so the textarea's own keyboard selection continues from the same anchor.
export function restore(renderer: CliRenderer, textarea: TextareaRenderable, draft: Draft) {
  if (draft.anchor === draft.caret) {
    textarea.cursorOffset = draft.caret
    return Promise.resolve()
  }
  textarea.cursorOffset = draft.anchor
  const done = Promise.withResolvers<void>()
  renderer.once(CliRenderEvents.FRAME, () => {
    if (!textarea.isDestroyed) restoreNow(textarea, draft)
    done.resolve()
  })
  renderer.requestRender()
  return done.promise
}

function restoreNow(textarea: TextareaRenderable, draft: Draft) {
  textarea.cursorOffset = draft.anchor
  const forward = draft.caret > draft.anchor
  for (let steps = draft.text.length + 1; steps > 0 && textarea.cursorOffset !== draft.caret; steps--) {
    const before = textarea.cursorOffset
    if (forward) textarea.moveCursorRight({ select: true })
    else textarea.moveCursorLeft({ select: true })
    if (textarea.cursorOffset === before) break
  }
}
