import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
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
        <box flexDirection="row" gap={1} onMouseDown={() => list().length > 2 && setOpen((x) => !x)}>
          <Show when={list().length > 2}>
            <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme().text}>
            <b>Todo</b>
          </text>
        </box>
        <Show when={list().length <= 2 || open()}>
          <For each={list()}>{(item) => <TodoItem status={item.status} content={item.content} />}</For>
        </Show>
      </box>
    </Show>
  )
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
