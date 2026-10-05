import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { onHeaderClick } from "./click"
import { createMemo, For, Match, Show, Switch, createSignal } from "solid-js"
import { useTuiConfig } from "../../config"

const id = "internal:sidebar-mcp"

const statuses = ["connected", "failed", "needs_client_registration", "needs_auth", "disabled"] as const

function View(props: { api: TuiPluginApi }) {
  const [open, setOpen] = createSignal(true)
  const theme = () => props.api.theme.current
  const tuiConfig = useTuiConfig()
  const summary = () => tuiConfig.sidebar?.mcp_summary ?? "default"
  const compact = () => tuiConfig.sidebar?.mcp_list === "compact"
  const list = createMemo(() => props.api.state.mcp())
  const counts = createMemo(() =>
    statuses
      .map((status) => ({ status, count: list().filter((item) => item.status === status).length }))
      .filter((item) => item.count > 0),
  )
  const on = createMemo(() => list().filter((item) => item.status === "connected").length)
  const bad = createMemo(
    () =>
      list().filter(
        (item) =>
          item.status === "failed" || item.status === "needs_auth" || item.status === "needs_client_registration",
      ).length,
  )

  const dot = (status: string) => {
    if (status === "connected") return theme().success
    if (status === "failed") return theme().error
    if (status === "disabled") return theme().textMuted
    if (status === "needs_auth") return theme().warning
    if (status === "needs_client_registration") return theme().error
    return theme().textMuted
  }

  return (
    <Show when={list().length > 0}>
      <box>
        <box flexDirection="row" gap={1} {...onHeaderClick(() => list().length > 2 && setOpen((x) => !x))}>
          <Show when={list().length > 2}>
            <text fg={theme().text} selectable={false}>
              {open() ? "▼" : "▶"}
            </text>
          </Show>
          <text fg={theme().text} selectable={false}>
            <b>MCP</b>
          </text>
          <Show when={summary() === "default" && !open()}>
            <text fg={theme().textMuted}>
              ({on()} active{bad() > 0 ? `, ${bad()} error${bad() > 1 ? "s" : ""}` : ""})
            </text>
          </Show>
          <Show when={summary() === "always" || (summary() === "collapsed" && !open())}>
            <text>
              <For each={counts()}>
                {(item, index) => (
                  <>
                    <span style={{ fg: dot(item.status) }}>{index() > 0 ? " •" : "•"}</span>
                    <span style={{ fg: theme().textMuted }}>{item.count}</span>
                  </>
                )}
              </For>
            </text>
          </Show>
        </box>
        <Show when={list().length <= 2 || open()}>
          <For each={list()}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  style={{
                    fg: dot(item.status),
                  }}
                >
                  •
                </text>
                <text fg={theme().text} wrapMode="word">
                  {item.name}
                  <Show when={!compact()}>
                    {" "}
                    <span style={{ fg: theme().textMuted }}>
                      <Switch fallback={item.status}>
                        <Match when={item.status === "connected"}>Connected</Match>
                        <Match when={item.status === "failed"}>
                          <i>{item.error}</i>
                        </Match>
                        <Match when={item.status === "disabled"}>Disabled</Match>
                        <Match when={item.status === "needs_auth"}>Needs auth</Match>
                        <Match when={item.status === "needs_client_registration"}>Needs client ID</Match>
                      </Switch>
                    </span>
                  </Show>
                </text>
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 200,
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
