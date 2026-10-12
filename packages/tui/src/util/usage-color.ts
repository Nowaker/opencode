import type { RGBA } from "@opentui/core"
import { UsageContextThresholdsDefault, type Usage } from "../config"
import { tint } from "../theme/color"

type LevelColors = { muted: RGBA; warning: RGBA; error: RGBA }

export function usageColors(colors: LevelColors, usage: Usage | undefined, percent: number | undefined, cost: number) {
  return {
    context:
      percent === undefined || usage?.context_color !== "colored"
        ? colors.muted
        : levelColor(colors, percent, usage.context_thresholds ?? UsageContextThresholdsDefault),
    cost: levelColor(colors, cost, usage?.cost_thresholds ?? []),
  }
}

// Above the first threshold is the warning color and above the last the error color; the ones between blend the two.
export function levelColor(colors: LevelColors, value: number, thresholds: readonly number[]) {
  const crossed = thresholds.filter((item) => value > item).length
  if (crossed === 0) return colors.muted
  if (crossed === 1) return colors.warning
  if (crossed === thresholds.length) return colors.error
  return tint(colors.warning, colors.error, (crossed - 1) / (thresholds.length - 1))
}
