import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { onHeaderClick } from "./click"
import { createMemo, createSignal, Show } from "solid-js"
import { useTuiConfig } from "../../config"
import { useBindings } from "../../keymap"
import { usageColors } from "../../util/usage-color"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

const wholeMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
})

const shortNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
})

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const tuiConfig = useTuiConfig()
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const session = createMemo(() => props.api.state.session.get(props.session_id))
  const cost = createMemo(() => session()?.cost ?? 0)
  const mode = createMemo(() => props.api.kv.get("sidebar_context", tuiConfig.sidebar?.context ?? "expanded"))
  const toggle = () => props.api.kv.set("sidebar_context", mode() === "compact" ? "expanded" : "compact")
  const [width, setWidth] = createSignal(0)

  useBindings(() => ({
    commands: [
      {
        name: "sidebar.context.toggle",
        title: mode() === "compact" ? "Expand sidebar context" : "Compact sidebar context",
        category: "Session",
        namespace: "palette",
        run() {
          toggle()
          props.api.ui.dialog.clear()
        },
      },
    ],
    bindings: props.api.tuiConfig.keybinds.get("sidebar.context.toggle"),
  }))

  const state = createMemo(() => {
    const last = msg().findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) {
      return {
        tokens: 0,
        percent: null,
      }
    }

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = props.api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    return {
      tokens,
      percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
    }
  })

  const colors = createMemo(() => usageColors(theme(), tuiConfig.usage, state().percent, cost()))

  // The sidebar width is not fixed, so compact mode shows the most detailed line that fits beside the toggle icon.
  const line = createMemo(() => {
    const tokens = state().tokens
    const percent = state().percent ?? 0
    const variants = [
      [`${tokens.toLocaleString()} tokens`, `${percent}% used`, `${money.format(cost())} spent`],
      [tokens.toLocaleString(), `${percent}%`, money.format(cost())],
      [shortNumber.format(tokens), `${percent}%`, (cost() >= 1 ? wholeMoney : money).format(cost())],
    ]
    return variants.find((item) => item.join(" · ").length <= width() - 2) ?? variants[variants.length - 1]
  })

  return (
    <box
      onSizeChange={function () {
        setWidth(this.width)
      }}
    >
      <Show
        when={mode() === "compact"}
        fallback={
          <>
            <box flexDirection="row" gap={1} {...onHeaderClick(toggle)}>
              <text fg={theme().text} selectable={false}>
                ▼
              </text>
              <text fg={theme().text} selectable={false}>
                <b>Context</b>
              </text>
            </box>
            <text fg={colors().context}>{state().tokens.toLocaleString()} tokens</text>
            <text fg={colors().context}>{state().percent ?? 0}% used</text>
            <text fg={colors().cost}>{money.format(cost())} spent</text>
          </>
        }
      >
        <box flexDirection="row" gap={1} {...onHeaderClick(toggle)}>
          <text fg={theme().text} selectable={false}>
            ▶
          </text>
          <text fg={theme().textMuted}>
            <span style={{ fg: colors().context }}>{line()[0]}</span>
            {" · "}
            <span style={{ fg: colors().context }}>{line()[1]}</span>
            {" · "}
            <span style={{ fg: colors().cost }}>{line()[2]}</span>
          </text>
        </box>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
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
