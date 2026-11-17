import { useRenderer, type JSX } from "@opentui/solid"
import { CliRenderEvents, KeyEvent, PasteEvent, type TextareaRenderable } from "@opentui/core"
import { createEffect, createSignal, onCleanup, onMount, splitProps, type Accessor } from "solid-js"
import { useRoute } from "../../context/route"
import { isPromptTraits, promptSelectionOccupancy } from "../../prompt/traits"

export type PendingInput =
  | { readonly type: "key"; readonly event: KeyEvent }
  | { readonly type: "paste"; readonly event: PasteEvent }

type Props = Omit<
  JSX.IntrinsicElements["textarea"],
  "width" | "minHeight" | "onKeyDown" | "onSubmit" | "onPaste" | "selectionOccupancy"
> & {
  readonly disabled: boolean
  readonly submit: () => void
  readonly input: Accessor<TextareaRenderable | undefined>
  readonly onReadyChange: (ready: boolean) => void
  readonly active: Accessor<boolean>
  readonly sessionID?: string
  readonly onPaste: (event: PasteEvent, applied?: () => void) => Promise<void>
  readonly takePendingInput: () => readonly PendingInput[] | undefined
  readonly onPendingInput: (events: readonly PendingInput[]) => void
}

export function PromptTextarea(props: Props) {
  const [local, textarea] = splitProps(props, [
    "disabled",
    "submit",
    "input",
    "onReadyChange",
    "active",
    "sessionID",
    "onPaste",
    "takePendingInput",
    "onPendingInput",
  ])
  const renderer = useRenderer()
  const [focusedEditor, setFocusedEditor] = createSignal(renderer.currentFocusedEditor)
  const route = useRoute()
  const owner = local.sessionID
  const ownsRoute = () => {
    const current = route.data
    switch (current.type) {
      case "home":
        return owner === undefined
      case "session":
        return current.sessionID === owner
      case "plugin":
        return false
      default: {
        const exhaustive: never = current
        return exhaustive
      }
    }
  }
  const keys = renderer.keyInput
  const focusChanged = () => setFocusedEditor(renderer.currentFocusedEditor)
  createEffect(() => {
    const input = local.input()
    if (!input || input.isDestroyed) return
    if (local.disabled || !local.active() || !ownsRoute()) {
      if (input.focused) input.blur()
      input.focusable = false
      return
    }
    input.focusable = true
    const focused = focusedEditor()
    if (!input.focused && (!focused || isPromptTraits(focused.traits))) input.focus()
  })
  let pending: PendingInput[] = []
  let consumed = 0
  let adopted = false
  let live = true
  let replaying = false
  let forwarding = false
  let pasteApplied: (() => void) | undefined
  let pasteSettled = Promise.resolve()
  const ownsFocus = () => {
    const focused = renderer.currentFocusedEditor
    return (
      live && ownsRoute() && local.active() && (!focused || focused === local.input() || isPromptTraits(focused.traits))
    )
  }
  const capture = () => !forwarding && (!adopted || replaying) && ownsFocus()
  const key = (event: KeyEvent) => {
    if (!capture() || event.defaultPrevented || event.propagationStopped) return
    pending.push({ type: "key", event: new KeyEvent(event) })
    event.preventDefault()
    event.stopPropagation()
  }
  const paste = (event: PasteEvent) => {
    if (!capture() || event.defaultPrevented || event.propagationStopped) return
    pending.push({ type: "paste", event: new PasteEvent(event.bytes.slice(), event.metadata) })
    event.preventDefault()
    event.stopPropagation()
  }
  const forward = (event: PendingInput) => {
    forwarding = true
    try {
      switch (event.type) {
        case "key":
          return keys.processParsedKey(event.event)
        case "paste":
          return keys.processPaste(event.event.bytes, event.event.metadata)
        default: {
          const exhaustive: never = event
          return exhaustive
        }
      }
    } finally {
      forwarding = false
    }
  }
  const flush = async () => {
    if (!adopted || replaying || !ownsFocus() || renderer.currentFocusedEditor !== local.input()) return
    pending = [...(local.takePendingInput() ?? []), ...pending]
    consumed = 0
    replaying = true
    try {
      while (ownsFocus() && renderer.currentFocusedEditor === local.input()) {
        const event = pending.at(consumed)
        if (!event) break
        switch (event.type) {
          case "key":
            consumed++
            forward(event)
            break
          case "paste":
            pasteApplied = () => {
              consumed++
            }
            try {
              forward(event)
            } finally {
              pasteApplied = undefined
            }
            await pasteSettled
            if (pending.at(consumed) === event) return
            break
          default: {
            const exhaustive: never = event
            return exhaustive
          }
        }
      }
    } finally {
      pending = pending.slice(consumed)
      consumed = 0
      replaying = false
    }
  }
  const adopt = () => {
    const input = local.input()
    if (!input || input.width <= 0 || input.height <= 0) return false
    adopted = true
    local.onReadyChange(true)
    renderer.off(CliRenderEvents.FRAME, adopt)
    void flush()
    return true
  }
  onMount(() => {
    renderer.on(CliRenderEvents.FOCUSED_EDITOR, focusChanged)
    keys.prependListener("keypress", key)
    keys.prependListener("keyrelease", key)
    keys.prependListener("paste", paste)
    const input = local.input()
    input?.on("focused", flush)
    onCleanup(() => input?.off("focused", flush))
    renderer.on(CliRenderEvents.FRAME, adopt)
  })
  onCleanup(() => {
    live = false
    renderer.off(CliRenderEvents.FOCUSED_EDITOR, focusChanged)
    renderer.off(CliRenderEvents.FRAME, adopt)
    keys.off("keypress", key)
    keys.off("keyrelease", key)
    keys.off("paste", paste)
    const waiting = [...(local.takePendingInput() ?? []), ...pending.slice(consumed)]
    if (waiting.length) local.onPendingInput(waiting)
    pending = []
    consumed = 0
  })
  return (
    <textarea
      {...textarea}
      width="100%"
      minHeight={1}
      selectionOccupancy={promptSelectionOccupancy}
      onPaste={(event) => {
        pasteSettled = local.onPaste(event, pasteApplied)
      }}
      onKeyDown={(event) => {
        if (local.disabled) event.preventDefault()
      }}
      onSubmit={() => {
        if (local.disabled) return
        // IME: double-defer so the last composed character is flushed before submission.
        setTimeout(() => setTimeout(local.submit, 0), 0)
      }}
    />
  )
}
