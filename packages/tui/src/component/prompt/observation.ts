import type { ComposerDraft } from "@opencode/plugin/tui/composer"
import { CliRenderEvents, type TextareaRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { clone } from "remeda"
import { createSignal, onCleanup, type Accessor } from "solid-js"
import type { PromptInfo } from "../../prompt/history"

export function createDraftObservation(
  target: Accessor<TextareaRenderable | undefined>,
  prompt: Accessor<PromptInfo & { mode: "normal" | "shell" }>,
  version: Accessor<number>,
) {
  const renderer = useRenderer()
  const [selection, setSelection] = createSignal(0)
  let active = true
  // Selection completion precedes the final native range update in the same dispatch.
  const changed = () => queueMicrotask(() => active && setSelection((value) => value + 1))
  renderer.on(CliRenderEvents.SELECTION, changed)
  onCleanup(() => {
    active = false
    renderer.off(CliRenderEvents.SELECTION, changed)
  })
  return (): ComposerDraft | undefined => {
    version()
    selection()
    const input = target()
    if (!input || input.isDestroyed) return
    const caret = input.cursorOffset
    const range = input.getSelection()
    const anchor = !range || range.start === range.end ? caret : caret === range.start ? range.end : range.start
    return freeze({ ...clone(prompt()), caret, selection: { anchor, focus: caret } })
  }
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
