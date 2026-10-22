import { createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { MouseButton, type MouseEvent } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import type { Part } from "@opencode-ai/sdk/v2"
import { useClipboard } from "../../context/clipboard"
import { useTheme } from "../../context/theme"
import { toolInputColors } from "../../theme/tool-code"
import { SplitBorder } from "../../ui/border"
import { copyText, onClick } from "../../ui/click"
import { idUnder } from "../../ui/id-click"
import { useToast } from "../../ui/toast"
import { yamlSegments } from "../../util/message-blocks"
import { provenanceView, splitVibetermHead } from "../../util/vibeterm-provenance"

// What the session-wide toggle last chose, and the sections opened or closed one at a time since, by
// text part ID. They last until opencode exits.
const [all, setAll] = createSignal(false)
const [overrides, setOverrides] = createSignal<Record<string, boolean>>({})

export const provenanceAll = all

export function provenanceExpanded(partID: string) {
  return overrides()[partID] ?? all()
}

export function setProvenance(partIDs: string[], open: boolean) {
  setOverrides((prev) => ({ ...prev, ...Object.fromEntries(partIDs.map((id) => [id, open])) }))
}

export function toggleAllProvenance() {
  setOverrides({})
  setAll((prev) => !prev)
}

export function messageProvenance(parts: Part[]) {
  return parts.flatMap((part) => {
    if (part.type !== "text" || part.synthetic) return []
    const view = provenanceView(part)
    return view ? [{ id: part.id, ...view }] : []
  })
}

export type VibetermHead = NonNullable<ReturnType<typeof vibetermHead>>

// The Vibeterm blocks a user message starts with, apart from the prompt they wrap. They come from
// the first text part the user sees; `body` is everything else that message shows. `full` is the
// stored delivery record, present only while it still describes the part: its fields, and the full
// message body when the record's text differs from what the model was sent.
export function vibetermHead(parts: Part[]) {
  const texts = parts.flatMap((part) => (part.type === "text" && !part.synthetic ? [part] : []))
  const first = texts[0]
  if (!first) return
  const split = splitVibetermHead(first.text)
  if (!split) return
  const view = provenanceView(first)
  const full = view && splitVibetermHead(view.fullText)
  return {
    id: first.id,
    head: split.head,
    fields: split.fields,
    body: [split.body, ...texts.slice(1).map((part) => part.text)].filter(Boolean).join("\n\n"),
    full: full && {
      head: full.head,
      fields: full.fields,
      count: view.provenance.entries.length,
      body: full.body === split.body ? undefined : full.body,
    },
  }
}

// The top of a delivered message: its Vibeterm fields with the tag lines hidden, under a bar in the
// Vibeterm color. It hovers and takes clicks apart from the prompt below it, so a click here never
// opens the message's actions. A click opens the full record when one is stored, an ID still takes
// its own click, and a right click copies the blocks.
export function VibetermSection(props: { head: VibetermHead; children?: JSX.Element }) {
  const { theme, vibeterm } = useTheme()
  const renderer = useRenderer()
  const clipboard = useClipboard()
  const toast = useToast()
  const [hover, setHover] = createSignal(false)
  const expanded = () => props.head.full !== undefined && provenanceExpanded(props.head.id)
  const fields = createMemo(() => yamlSegments(expanded() ? props.head.full!.fields : props.head.fields))
  const colors = createMemo(() => toolInputColors(theme))
  const click = onClick((event: MouseEvent) => {
    if (idUnder(renderer.currentRenderBuffer, event)) return
    event.stopPropagation()
    if (props.head.full) setProvenance([props.head.id], !expanded())
  })
  return (
    <box border={["left"]} borderColor={vibeterm()} customBorderChars={SplitBorder.customBorderChars}>
      <box
        onMouseOver={() => setHover(true)}
        onMouseOut={() => setHover(false)}
        onMouseDown={(event: MouseEvent) => {
          click.onMouseDown(event)
          if (event.button !== MouseButton.RIGHT || renderer.getSelection()?.getSelectedText()) return
          event.preventDefault()
          event.stopPropagation()
          copyText(clipboard, toast.show, props.head.full?.head ?? props.head.head, "Vibeterm metadata")
        }}
        onMouseUp={click.onMouseUp}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
        flexShrink={0}
      >
        <text fg={theme.text}>
          <For each={fields()}>{(segment) => <span style={{ fg: colors()[segment.kind] }}>{segment.text}</span>}</For>
        </text>
        <Show when={expanded() && props.head.full?.body !== undefined}>
          <text fg={theme.textMuted} marginTop={1}>
            Full message as delivered
          </text>
          {props.children}
        </Show>
        <Show when={props.head.full}>
          {(full) => (
            <text fg={theme.textMuted}>
              {expanded()
                ? "▾ Click to collapse"
                : `▸ ${full().count} ${full().count === 1 ? "field" : "fields"} in the full record · Click to expand`}
            </text>
          )}
        </Show>
      </box>
    </box>
  )
}
