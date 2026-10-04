import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { onHeaderClick } from "./click"
import { createMemo, For, Show, createSignal } from "solid-js"

const id = "internal:sidebar-lsp"

function View(props: { api: TuiPluginApi }) {
  const [open, setOpen] = createSignal(true)
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.lsp())
  const off = createMemo(() => !props.api.state.config.lsp && list().length === 0)

  return (
    <box>
      <box flexDirection="row" gap={1} {...onHeaderClick(() => list().length > 2 && setOpen((x) => !x))}>
        <Show when={list().length > 2}>
          <text fg={theme().text} selectable={false}>
            {open() ? "▼" : "▶"}
          </text>
        </Show>
        <text fg={theme().text} selectable={false}>
          <b>{off() ? "LSPs" : "LSP"}</b>
          <Show when={off()}>
            <span style={{ fg: theme().textMuted }}> are disabled</span>
          </Show>
        </text>
      </box>
      <Show when={list().length <= 2 || open()}>
        <Show when={list().length === 0 && !off()}>
          <text fg={theme().textMuted}>LSPs will activate as files are read</text>
        </Show>
        <For each={list()}>
          {(item) => (
            <box flexDirection="row" gap={1}>
              <text
                flexShrink={0}
                style={{
                  fg: item.status === "connected" ? theme().success : theme().error,
                }}
              >
                •
              </text>
              <text fg={theme().textMuted}>
                {item.id} {item.root}
              </text>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 300,
    slots: {
      sidebar_content() {
        return <View api={api} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
