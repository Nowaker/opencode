import { TextareaRenderable, TextAttributes, type RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createSignal, onCleanup, onMount } from "solid-js"
import { useTheme } from "../context/theme"
import { useTuiConfig } from "../config"
import { useBindings } from "../keymap"
import { createPromptUndo } from "../prompt/undo"
import { useDialog } from "../ui/dialog"
import { PromptFrame, promptFrameRows } from "./prompt/frame"
import { onClick } from "../ui/click"

export type DialogPasteProps = {
  text: string
  // The prompt's bar color, so the editor's box matches the prompt's.
  color: RGBA
  onChange(text: string): void
  onInline(): void
}

// The text behind a paste placeholder, in the prompt's own editor and box: the same textarea,
// input keybinds, mouse caret placement and grouped undo, without the agent line. Enter saves and
// closes, as Esc does, and the prompt's newline keys add a line. Inline, above the editor, replaces the placeholder with the
// text; Up on the editor's first row moves to it, Enter presses it and Down goes back.
export function DialogPaste(props: DialogPasteProps) {
  const dialog = useDialog()
  const { theme, syntax } = useTheme()
  const tuiConfig = useTuiConfig()
  const dimensions = useTerminalDimensions()
  const [target, setTarget] = createSignal<TextareaRenderable>()
  const [lines, setLines] = createSignal(props.text.split("\n").length)
  const [rows, setRows] = createSignal(props.text.split("\n").length)
  const [inlineFocused, setInlineFocused] = createSignal(false)
  const [inlinePressed, setInlinePressed] = createSignal(false)
  const undo = createPromptUndo({ depth: () => tuiConfig.prompt?.undo_depth ?? 500 })
  let textarea: TextareaRenderable
  let applying = false
  let pressing: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(pressing))

  // The dialog starts a quarter of the way down the screen (ui/dialog.tsx), and around the editor
  // it has 6 rows: its top padding, the title, two gaps, the action row and its bottom padding,
  // plus the prompt box's own rows. The editor is as tall as the text once wrapped at its width,
  // up to what is left above a one-row margin; longer text scrolls inside it.
  const editorHeight = () => {
    const room = dimensions().height - Math.ceil(dimensions().height / 4) - 7 - promptFrameRows(true)
    return Math.max(1, Math.min(room, Math.max(3, rows())))
  }

  function measure() {
    if (!textarea || textarea.isDestroyed) return
    setRows(textarea.editorView.getTotalVirtualLineCount())
  }

  function focusEditor() {
    setInlineFocused(false)
    if (textarea && !textarea.isDestroyed) textarea.focus()
  }

  function focusInline() {
    setInlineFocused(true)
    textarea.blur()
  }

  // Shown pressed for a moment, so a key press reads as one before the dialog closes.
  function inline() {
    if (inlinePressed()) return
    setInlineFocused(true)
    setInlinePressed(true)
    pressing = setTimeout(() => {
      props.onInline()
      dialog.clear()
    }, 120)
  }

  const state = () => ({ input: textarea.plainText, parts: [], mode: "normal" as const, cursor: textarea.cursorOffset })

  function step(direction: "undo" | "redo") {
    undo.observe(state())
    const next = direction === "undo" ? undo.undo(state()) : undo.redo(state())
    if (!next) return
    applying = true
    textarea.setText(next.input)
    textarea.cursorOffset = next.cursor
    applying = false
    undo.sync(state())
    props.onChange(next.input)
  }

  useBindings(() => ({
    target,
    enabled: target() !== undefined,
    priority: 1,
    commands: [
      { name: "input.submit", title: "Save and close", category: "Dialog", run: () => dialog.clear() },
      { name: "input.undo", title: "Undo", category: "Dialog", run: () => step("undo") },
      { name: "input.redo", title: "Redo", category: "Dialog", run: () => step("redo") },
      {
        name: "input.move.up",
        title: "Up, or to Inline from the first row",
        category: "Dialog",
        run: () => {
          if (textarea.scrollY + textarea.visualCursor.visualRow === 0) return focusInline()
          textarea.moveCursorUp()
        },
      },
    ],
  }))

  // While Inline has focus the editor does not, so these keys are not tied to it.
  useBindings(() => ({
    enabled: inlineFocused(),
    priority: 1,
    commands: [
      { name: "dialog.paste.inline", title: "Inline", category: "Dialog", run: inline },
      { name: "dialog.paste.editor", title: "Back to the text", category: "Dialog", run: focusEditor },
    ],
    bindings: [
      ...tuiConfig.keybinds.get("input.submit").map((binding) => ({ ...binding, cmd: "dialog.paste.inline" })),
      ...tuiConfig.keybinds.get("input.move.down").map((binding) => ({ ...binding, cmd: "dialog.paste.editor" })),
    ],
  }))

  onMount(() => {
    dialog.setSize("xlarge")
    textarea.gotoBufferHome()
    undo.sync(state())
    setTimeout(() => {
      if (!textarea || textarea.isDestroyed) return
      textarea.focus()
      measure()
    }, 1)
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <text attributes={TextAttributes.BOLD} fg={theme.text}>
        Pasted text <span style={{ fg: theme.textMuted }}>{lines()} lines</span>
      </text>
      <box flexDirection="row" gap={2}>
        <text fg={theme.text} {...onClick(() => dialog.clear())}>
          esc/enter <span style={{ fg: theme.textMuted }}>save</span>
        </text>
        <box
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={inlineFocused() ? theme.primary : theme.backgroundElement}
          {...onClick(inline)}
        >
          <text
            fg={inlineFocused() ? theme.selectedListItemText : theme.text}
            attributes={inlinePressed() ? TextAttributes.BOLD | TextAttributes.INVERSE : 0}
          >
            Inline
          </text>
        </box>
        <text fg={theme.textMuted}>
          {inlineFocused() ? "enter inline · ↓ back" : "↑ to select"}
        </text>
      </box>
      <PromptFrame color={props.color} padBottom>
        <textarea
          width="100%"
          height={editorHeight()}
          initialValue={props.text}
          ref={(value: TextareaRenderable) => {
            textarea = value
            setTarget(value)
          }}
          onContentChange={() => {
            const text = textarea.plainText
            setLines(text.split("\n").length)
            measure()
            props.onChange(text)
            if (!applying) undo.observe(state())
          }}
          onCursorChange={() => {
            if (!applying) undo.observe(state())
          }}
          onSizeChange={measure}
          onMouseDown={() => focusEditor()}
          textColor={theme.text}
          focusedTextColor={theme.text}
          backgroundColor={theme.backgroundElement}
          focusedBackgroundColor={theme.backgroundElement}
          cursorColor={theme.text}
          cursorStyle={tuiConfig.cursor}
          syntaxStyle={syntax()}
        />
      </PromptFrame>
    </box>
  )
}
