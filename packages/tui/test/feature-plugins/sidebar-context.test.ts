import { RGBA } from "@opentui/core"
import { expect, test } from "bun:test"
import { SidebarContextThresholdsDefault } from "../../src/config"
import { tint } from "../../src/context/theme"
import { levelColor } from "../../src/feature-plugins/sidebar/context"

const theme = {
  textMuted: RGBA.fromHex("#808080"),
  warning: RGBA.fromHex("#ffcc00"),
  error: RGBA.fromHex("#ff0000"),
}

test("keeps the muted color without thresholds or at a threshold", () => {
  expect(levelColor(theme, 1000, [])).toBe(theme.textMuted)
  expect(levelColor(theme, 60, SidebarContextThresholdsDefault)).toBe(theme.textMuted)
})

test("ramps from warning above the first threshold to error above the last", () => {
  expect(levelColor(theme, 61, SidebarContextThresholdsDefault)).toBe(theme.warning)
  expect(levelColor(theme, 75, SidebarContextThresholdsDefault).toInts()).toEqual(
    tint(theme.warning, theme.error, 1 / 3).toInts(),
  )
  expect(levelColor(theme, 85, SidebarContextThresholdsDefault).toInts()).toEqual(
    tint(theme.warning, theme.error, 2 / 3).toInts(),
  )
  expect(levelColor(theme, 91, SidebarContextThresholdsDefault)).toBe(theme.error)
})

test("uses the warning color for a single threshold and ignores threshold order", () => {
  expect(levelColor(theme, 5, [5])).toBe(theme.textMuted)
  expect(levelColor(theme, 5.01, [5])).toBe(theme.warning)
  expect(levelColor(theme, 25, [20, 5])).toBe(theme.error)
  expect(levelColor(theme, 10, [20, 5])).toBe(theme.warning)
})
