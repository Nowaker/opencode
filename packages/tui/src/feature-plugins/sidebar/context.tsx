import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi, TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { onHeaderClick } from "./click"
import { createMemo, createSignal, Show } from "solid-js"
import { SidebarContextThresholdsDefault, useTuiConfig } from "../../config"
import { tint } from "../../context/theme"
import { useBindings } from "../../keymap"

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

  const contextColor = createMemo(() => {
    const percent = state().percent
    if (percent === null || tuiConfig.sidebar?.context_color !== "colored") return theme().textMuted
    return levelColor(theme(), percent, tuiConfig.sidebar?.context_thresholds ?? SidebarContextThresholdsDefault)
  })
  const costColor = createMemo(() => levelColor(theme(), cost(), tuiConfig.sidebar?.cost_thresholds ?? []))

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
            <text fg={contextColor()}>{state().tokens.toLocaleString()} tokens</text>
            <text fg={contextColor()}>{state().percent ?? 0}% used</text>
            <text fg={costColor()}>{money.format(cost())} spent</text>
          </>
        }
      >
        <box flexDirection="row" gap={1} {...onHeaderClick(toggle)}>
          <text fg={theme().text} selectable={false}>
            ▶
          </text>
          <text fg={theme().textMuted} selectable={false}>
            <span style={{ fg: contextColor() }}>{line()[0]}</span>
            {" · "}
            <span style={{ fg: contextColor() }}>{line()[1]}</span>
            {" · "}
            <span style={{ fg: costColor() }}>{line()[2]}</span>
          </text>
        </box>
      </Show>
    </box>
  )
}

// Above the first threshold is the warning color and above the last the error color; the ones between blend the two.
export function levelColor(
  theme: Pick<TuiThemeCurrent, "textMuted" | "warning" | "error">,
  value: number,
  thresholds: readonly number[],
) {
  const crossed = thresholds.filter((item) => value > item).length
  if (crossed === 0) return theme.textMuted
  if (crossed === 1) return theme.warning
  if (crossed === thresholds.length) return theme.error
  return tint(theme.warning, theme.error, (crossed - 1) / (thresholds.length - 1))
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
