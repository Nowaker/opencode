import { RGBA } from "@opentui/core"
import { expect, test } from "bun:test"
import { UsageContextThresholdsDefault } from "../../src/config"
import { tint } from "../../src/theme/color"
import { levelColor, usageColors } from "../../src/util/usage-color"

const colors = {
  muted: RGBA.fromHex("#808080"),
  warning: RGBA.fromHex("#ffcc00"),
  error: RGBA.fromHex("#ff0000"),
}

test("keeps the muted color without thresholds or at a threshold", () => {
  expect(levelColor(colors, 1000, [])).toBe(colors.muted)
  expect(levelColor(colors, 60, UsageContextThresholdsDefault)).toBe(colors.muted)
})

test("ramps from warning above the first threshold to error above the last", () => {
  expect(levelColor(colors, 61, UsageContextThresholdsDefault)).toBe(colors.warning)
  expect(levelColor(colors, 75, UsageContextThresholdsDefault).toInts()).toEqual(
    tint(colors.warning, colors.error, 1 / 3).toInts(),
  )
  expect(levelColor(colors, 85, UsageContextThresholdsDefault).toInts()).toEqual(
    tint(colors.warning, colors.error, 2 / 3).toInts(),
  )
  expect(levelColor(colors, 91, UsageContextThresholdsDefault)).toBe(colors.error)
})

test("uses the warning color for a single threshold and ignores threshold order", () => {
  expect(levelColor(colors, 5, [5])).toBe(colors.muted)
  expect(levelColor(colors, 5.01, [5])).toBe(colors.warning)
  expect(levelColor(colors, 25, [20, 5])).toBe(colors.error)
  expect(levelColor(colors, 10, [20, 5])).toBe(colors.warning)
})

test("colors context only when colored and cost only with thresholds", () => {
  expect(usageColors(colors, undefined, 95, 100)).toEqual({ context: colors.muted, cost: colors.muted })
  expect(usageColors(colors, { context_color: "colored" }, 95, 100)).toEqual({
    context: colors.error,
    cost: colors.muted,
  })
  expect(usageColors(colors, { context_color: "colored" }, undefined, 0).context).toBe(colors.muted)
  expect(usageColors(colors, { cost_thresholds: [5] }, 95, 6)).toEqual({ context: colors.muted, cost: colors.warning })
  expect(usageColors(colors, { context_color: "colored", context_thresholds: [10] }, 11, 0).context).toBe(
    colors.warning,
  )
})
