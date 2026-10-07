import { Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import { registerOpencodeSpinner } from "./register-spinner"
import { TuiLayout } from "../layout"

registerOpencodeSpinner()

export const SPINNER_FRAMES = [...TuiLayout.Spinner.frames]

export function Spinner(props: { children?: JSX.Element; color?: RGBA }) {
  const { theme } = useTheme()
  const kv = useKV()
  const color = () => props.color ?? theme.textMuted
  return (
    <Show when={kv.get("animations_enabled", true)} fallback={<text fg={color()}>⋯ {props.children}</text>}>
      <box flexDirection="row" gap={1}>
        <spinner frames={SPINNER_FRAMES} interval={TuiLayout.Spinner.interval} color={color()} />
        <Show when={props.children}>
          <text fg={color()}>{props.children}</text>
        </Show>
      </box>
    </Show>
  )
}
