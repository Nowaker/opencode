import { RGBA } from "@opentui/core"
import { expect, test } from "bun:test"
import { UsageContextThresholdsDefault } from "../../src/config"
import { tint } from "../../src/theme"
import { levelColor, usageColors } from "../../src/util/usage-color"

const theme = {
  textMuted: RGBA.fromHex("#808080"),
  warning: RGBA.fromHex("#ffcc00"),
  error: RGBA.fromHex("#ff0000"),
}

test("keeps the muted color without thresholds or at a threshold", () => {
  expect(levelColor(theme, 1000, [])).toBe(theme.textMuted)
  expect(levelColor(theme, 60, UsageContextThresholdsDefault)).toBe(theme.textMuted)
})

test("ramps from warning above the first threshold to error above the last", () => {
  expect(levelColor(theme, 61, UsageContextThresholdsDefault)).toBe(theme.warning)
  expect(levelColor(theme, 75, UsageContextThresholdsDefault).toInts()).toEqual(
    tint(theme.warning, theme.error, 1 / 3).toInts(),
  )
  expect(levelColor(theme, 85, UsageContextThresholdsDefault).toInts()).toEqual(
    tint(theme.warning, theme.error, 2 / 3).toInts(),
  )
  expect(levelColor(theme, 91, UsageContextThresholdsDefault)).toBe(theme.error)
})

test("uses the warning color for a single threshold and ignores threshold order", () => {
  expect(levelColor(theme, 5, [5])).toBe(theme.textMuted)
  expect(levelColor(theme, 5.01, [5])).toBe(theme.warning)
  expect(levelColor(theme, 25, [20, 5])).toBe(theme.error)
  expect(levelColor(theme, 10, [20, 5])).toBe(theme.warning)
})

test("colors context only when colored and cost only with thresholds", () => {
  expect(usageColors(theme, undefined, 95, 100)).toEqual({ context: theme.textMuted, cost: theme.textMuted })
  expect(usageColors(theme, { context_color: "colored" }, 95, 100)).toEqual({
    context: theme.error,
    cost: theme.textMuted,
  })
  expect(usageColors(theme, { context_color: "colored" }, null, 0).context).toBe(theme.textMuted)
  expect(usageColors(theme, { cost_thresholds: [5] }, 95, 6)).toEqual({ context: theme.textMuted, cost: theme.warning })
  expect(usageColors(theme, { context_color: "colored", context_thresholds: [10] }, 11, 0).context).toBe(theme.warning)
})
