import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { onHeaderClick } from "./click"
import { createEffect, createMemo, For, on, Show, createSignal } from "solid-js"
import { TodoItem } from "../../component/todo-item"
import { useTuiConfig } from "../../config"

const id = "internal:sidebar-todo"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [open, setOpen] = createSignal(true)
  const theme = () => props.api.theme.current
  const tuiConfig = useTuiConfig()
  const completed = () => tuiConfig.sidebar?.todo_completed ?? "hide"
  const list = createMemo(() => props.api.state.session.todo(props.session_id))
  const done = createMemo(() => list().length > 0 && list().every((item) => item.status === "completed"))
  const show = createMemo(() => list().length > 0 && (!done() || completed() !== "hide"))
  const summary = createMemo(() => {
    const when = tuiConfig.sidebar?.todo_summary ?? "never"
    // The list only collapses past two items, so "collapsed" never shows on a shorter list.
    if (when === "never" || (when === "collapsed" && (list().length <= 2 || open()))) return ""
    return todoSummary(list(), tuiConfig.sidebar?.todo_summary_style ?? "progress")
  })

  // "collapsed" folds the list when its last item completes and unfolds it when
  // open work returns; a click in between still toggles it as usual.
  createEffect(
    on(done, (isDone) => {
      if (completed() === "collapsed") setOpen(!isDone)
    }),
  )

  return (
    <Show when={show()}>
      <box>
        <box flexDirection="row" gap={1} {...onHeaderClick(() => list().length > 2 && setOpen((x) => !x))}>
          <Show when={list().length > 2}>
            <text fg={theme().text} selectable={false}>
              {open() ? "▼" : "▶"}
            </text>
          </Show>
          <text fg={theme().text} selectable={false}>
            <b>Todo</b>
          </text>
          <Show when={summary()}>
            <text fg={theme().text}>{summary()}</text>
          </Show>
        </box>
        <Show when={list().length <= 2 || open()}>
          <For each={list()}>{(item) => <TodoItem status={item.status} content={item.content} />}</For>
        </Show>
      </box>
    </Show>
  )
}

// "progress" is done+in_progress/total, dropping +in_progress while nothing is in
// progress (8/12, not 8+0/12). "icons" reuses the todo item glyphs and skips zeros.
export function todoSummary(list: readonly { status: string }[], style: "progress" | "icons") {
  const count = (status: string) => list.filter((item) => item.status === status).length
  const wip = count("in_progress")
  if (style === "progress") return `${count("completed")}${wip > 0 ? `+${wip}` : ""}/${list.length}`
  return [
    { icon: "✓", count: count("completed") },
    { icon: "•", count: wip },
    { icon: "○", count: count("pending") },
  ]
    .filter((entry) => entry.count > 0)
    .map((entry) => `${entry.icon}${entry.count}`)
    .join(" ")
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 400,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
