import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createEffect, createMemo, Show } from "solid-js"
import { Tips } from "./tips-view"
import { useBindings } from "../../keymap"
import { TuiLayout } from "../../layout"
import { InstantRecord } from "../../instant/record"
import { useTuiPaths } from "../../context/runtime"
import { useTuiConfig } from "../../config"

const id = "internal:home-tips"

function View(props: { api: TuiPluginApi; hidden: boolean; show: boolean; connected: boolean }) {
  const paths = useTuiPaths()
  useBindings(() => ({
    commands: [
      {
        name: "tips.toggle",
        title: props.hidden ? "Show tips" : "Hide tips",
        category: "System",
        namespace: "palette",
        run() {
          props.api.kv.set("tips_hidden", !props.hidden)
          props.api.ui.dialog.clear()
        },
      },
    ],
    bindings: props.api.tuiConfig.keybinds.get("tips.toggle"),
  }))

  // Hidden tips take no rows, which the instant startup screen learns from the record.
  createEffect(() => {
    if (props.hidden) InstantRecord.record({ directory: paths.cwd, entry: { homeBottomRows: 0 } })
  })

  return (
    <Show when={!props.hidden}>
      <box
        width="100%"
        maxWidth={TuiLayout.Home.tipsMaxWidth}
        alignItems="center"
        paddingTop={TuiLayout.Home.tipsPaddingTop}
        flexShrink={1}
        onSizeChange={function () {
          InstantRecord.record({ directory: paths.cwd, entry: { homeBottomRows: this.height } })
        }}
      >
        <Show when={props.show}>
          <Tips api={props.api} connected={props.connected} />
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      home_bottom() {
        const config = useTuiConfig()
        const hidden = createMemo(
          () => !TuiLayout.homeTipsShown({ kv: api.kv.get("tips_hidden"), configured: config.home?.tips }),
        )
        const first = createMemo(() => api.state.session.count() === 0)
        const connected = createMemo(() =>
          api.state.provider.some(
            (item) => item.id !== "opencode" || Object.values(item.models).some((model) => model.cost?.input !== 0),
          ),
        )
        const show = createMemo(() => (!first() || !connected()) && !hidden())
        return <View api={api} hidden={hidden()} show={show()} connected={connected()} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
