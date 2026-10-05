import type { RGBA } from "@opentui/core"
import { UsageContextThresholdsDefault, type Usage } from "../config"
import { tint } from "../theme"

type LevelTheme = { textMuted: RGBA; warning: RGBA; error: RGBA }

export function usageColors(theme: LevelTheme, usage: Usage | undefined, percent: number | null, cost: number) {
  return {
    context:
      percent === null || usage?.context_color !== "colored"
        ? theme.textMuted
        : levelColor(theme, percent, usage.context_thresholds ?? UsageContextThresholdsDefault),
    cost: levelColor(theme, cost, usage?.cost_thresholds ?? []),
  }
}

// Above the first threshold is the warning color and above the last the error color; the ones between blend the two.
export function levelColor(theme: LevelTheme, value: number, thresholds: readonly number[]) {
  const crossed = thresholds.filter((item) => value > item).length
  if (crossed === 0) return theme.textMuted
  if (crossed === 1) return theme.warning
  if (crossed === thresholds.length) return theme.error
  return tint(theme.warning, theme.error, (crossed - 1) / (thresholds.length - 1))
}
