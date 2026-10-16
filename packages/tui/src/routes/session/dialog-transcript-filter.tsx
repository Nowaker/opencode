import { ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, onMount, Show, untrack } from "solid-js"
import { useTheme } from "../../context/theme"
import { useKV } from "../../context/kv"
import { useSync } from "../../context/sync"
import { useTuiConfig } from "../../config"
import { useBindings } from "../../keymap"
import { useDialog } from "../../ui/dialog"
import { useToast } from "../../ui/toast"
import { onClick } from "../../ui/click"
import { getScrollAcceleration } from "../../util/scroll"
import { TranscriptFilter } from "./transcript-filter"

// Second-level rows offered for tool calls: the session's most used tools, then "Other tools".
const TOP_TOOLS = 10

type Row = {
  kind: TranscriptFilter.Kind
  label: string
  count: number
  depth: 0 | 1
  // A second-level row's name; null is "Other tools".
  name?: string | null
}

// Every kind of transcript entry with a checkbox, most important first; ticked shows. Unticking
// Tool calls or File actions opens their second level, to show only some of them. Changes apply to
// the transcript at once. Arrows move, space or a click toggles, enter or esc closes.
export function DialogTranscriptFilter(props: { sessionID: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const kv = useKV()
  const sync = useSync()
  const toast = useToast()
  const dimensions = useTerminalDimensions()
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const counts = untrack(() =>
    TranscriptFilter.count(sync.data.message[props.sessionID] ?? [], (id) => sync.data.part[id] ?? []),
  )
  const topTools = counts.tools.slice(0, TOP_TOOLS)
  const otherTools = counts.tools.slice(TOP_TOOLS).reduce((sum, tool) => sum + tool.count, 0)
  const selection = createMemo(() => TranscriptFilter.resolve(tuiConfig, kv))
  const [selected, setSelected] = createSignal(0)
  let scroll: ScrollBoxRenderable | undefined

  const rows = createMemo(() =>
    TranscriptFilter.Kinds.flatMap((kind): Row[] => {
      const row: Row = { kind: kind.key, label: kind.label, count: counts.kinds[kind.key], depth: 0 }
      if (selection()[kind.key].shown) return [row]
      if (kind.key === "tools")
        return [
          row,
          ...topTools.map(
            (tool): Row => ({ kind: "tools", label: tool.name, count: tool.count, depth: 1, name: tool.name }),
          ),
          { kind: "tools", label: "Other tools", count: otherTools, depth: 1, name: null },
        ]
      if (kind.key === "file_actions")
        return [
          row,
          ...TranscriptFilter.FileActions.toSorted((a, b) => counts.files[b.key] - counts.files[a.key]).map(
            (action): Row => ({
              kind: "file_actions",
              label: action.label,
              count: counts.files[action.key],
              depth: 1,
              name: action.key,
            }),
          ),
        ]
      return [row]
    }),
  )

  const checked = (row: Row) => {
    const group = selection()[row.kind]
    if (row.name === undefined) return group.shown
    if (row.name === null) return group.other
    return group.only[row.name] ?? group.other
  }

  function toggle(row: Row) {
    const message =
      row.name === undefined
        ? TranscriptFilter.toggleKind(tuiConfig, kv, row.kind)
        : TranscriptFilter.toggleName(
            tuiConfig,
            kv,
            row.kind as "tools" | "file_actions",
            row.name ?? undefined,
            topTools.map((tool) => tool.name),
          )
    if (message) toast.show({ message, variant: "info" })
  }

  function moveTo(index: number) {
    const total = rows().length
    const next = (index + total) % total
    setSelected(next)
    const target = scroll?.content.getChildren()[next]
    if (!scroll || !target) return
    const y = target.y - scroll.viewport.y
    if (y < 0) scroll.scrollBy(y)
    if (y >= scroll.viewport.height) scroll.scrollBy(y - scroll.viewport.height + 1)
  }

  // The dialog starts a quarter of the way down the screen (ui/dialog.tsx); around the list it has
  // its top padding, the title, a gap, the hint row and its bottom padding, plus a one-row margin.
  const height = createMemo(() =>
    Math.max(3, Math.min(rows().length, dimensions().height - Math.ceil(dimensions().height / 4) - 6)),
  )

  useBindings(() => ({
    commands: [
      {
        name: "dialog.select.prev",
        title: "Previous entry kind",
        category: "Dialog",
        run: () => moveTo(selected() - 1),
      },
      { name: "dialog.select.next", title: "Next entry kind", category: "Dialog", run: () => moveTo(selected() + 1) },
      {
        name: "dialog.select.page_up",
        title: "Page up",
        category: "Dialog",
        run: () => moveTo(Math.max(0, selected() - height())),
      },
      {
        name: "dialog.select.page_down",
        title: "Page down",
        category: "Dialog",
        run: () => moveTo(Math.min(rows().length - 1, selected() + height())),
      },
      { name: "dialog.select.home", title: "First entry kind", category: "Dialog", run: () => moveTo(0) },
      { name: "dialog.select.end", title: "Last entry kind", category: "Dialog", run: () => moveTo(rows().length - 1) },
      { name: "dialog.select.submit", title: "Close", category: "Dialog", run: () => dialog.clear() },
    ],
    bindings: [
      ...tuiConfig.keybinds.gather("dialog.select", [
        "dialog.select.prev",
        "dialog.select.next",
        "dialog.select.page_up",
        "dialog.select.page_down",
        "dialog.select.home",
        "dialog.select.end",
        "dialog.select.submit",
      ]),
      {
        key: "space",
        desc: "Show or hide the selected kind",
        group: "Dialog",
        cmd: () => {
          const row = rows()[selected()]
          if (row) toggle(row)
        },
      },
    ],
  }))

  onMount(() => dialog.setSize("medium"))

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between" gap={2}>
        <text attributes={TextAttributes.BOLD} fg={theme.text} wrapMode="none">
          Transcript filter
        </text>
        <text fg={theme.textMuted} wrapMode="none" {...onClick(() => dialog.clear())}>
          esc
        </text>
      </box>
      <scrollbox
        ref={(value: ScrollBoxRenderable) => (scroll = value)}
        height={height()}
        scrollAcceleration={scrollAcceleration()}
      >
        <For each={rows()}>
          {(row, index) => {
            const current = () => selected() === index()
            return (
              <box
                flexDirection="row"
                gap={1}
                paddingLeft={1 + row.depth * 4}
                paddingRight={1}
                backgroundColor={current() ? theme.primary : undefined}
                {...onClick(() => {
                  setSelected(index())
                  toggle(row)
                })}
              >
                <text
                  flexGrow={1}
                  flexShrink={1}
                  wrapMode="none"
                  fg={current() ? theme.selectedListItemText : row.count === 0 ? theme.textMuted : theme.text}
                >
                  {checked(row) ? "[x] " : "[ ] "}
                  {row.label}
                </text>
                <Show when={row.count > 0}>
                  <text flexShrink={0} fg={current() ? theme.selectedListItemText : theme.textMuted}>
                    {row.count.toLocaleString("en-US")}
                  </text>
                </Show>
              </box>
            )
          }}
        </For>
      </scrollbox>
      <box flexDirection="row" justifyContent="flex-end" gap={3}>
        <text fg={theme.text} wrapMode="none">
          space <span style={{ fg: theme.textMuted }}>show/hide</span>
        </text>
        <text fg={theme.text} wrapMode="none" {...onClick(() => dialog.clear())}>
          enter <span style={{ fg: theme.textMuted }}>close</span>
        </text>
      </box>
    </box>
  )
}
