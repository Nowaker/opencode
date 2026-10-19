import { createMemo, createSignal, For, Show, type JSX } from "solid-js"
import type { MouseEvent } from "@opentui/core"
import type { Part } from "@opencode-ai/sdk/v2"
import { useTheme } from "../../context/theme"
import { toolInputColors } from "../../theme/tool-code"
import { onClick } from "../../ui/click"
import { yamlSegments } from "../../util/message-blocks"
import { provenanceFields, provenanceView, type VibetermProvenance } from "../../util/vibeterm-provenance"

// What the session-wide toggle last chose, and the views opened or closed one at a time since, by
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

// The full delivery record behind a message's compact `[vibeterm_metadata]` block: one muted row
// that a click opens and closes, then the full text a human saw (`children`) and every field of the
// record. The click stops at the row, so it does not also open the message's actions.
export function ProvenanceView(props: { id: string; provenance: VibetermProvenance; children: JSX.Element }) {
  const { theme } = useTheme()
  const expanded = () => provenanceExpanded(props.id)
  const count = () => props.provenance.entries.length
  const fields = createMemo(() => yamlSegments(provenanceFields(props.provenance.entries)))
  const colors = createMemo(() => toolInputColors(theme))
  return (
    <box paddingTop={1}>
      <text
        fg={theme.textMuted}
        {...onClick((event: MouseEvent) => {
          event.stopPropagation()
          setProvenance([props.id], !expanded())
        })}
      >
        {expanded() ? "▾" : "▸"} Delivery provenance · {count()} {count() === 1 ? "field" : "fields"} ·{" "}
        {expanded() ? "Click to collapse" : "Click to expand"}
      </text>
      <Show when={expanded()}>
        <box paddingTop={1} paddingLeft={2}>
          {props.children}
          <text fg={theme.textMuted} marginTop={1}>
            Fields
          </text>
          <text fg={theme.text}>
            <For each={fields()}>{(segment) => <span style={{ fg: colors()[segment.kind] }}>{segment.text}</span>}</For>
          </text>
        </box>
      </Show>
    </box>
  )
}
