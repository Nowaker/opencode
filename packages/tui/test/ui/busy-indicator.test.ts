import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { TuiLayout } from "../../src/layout"
import { busyIndicator } from "../../src/ui/spinner"

const color = RGBA.fromHex("#00ff00")

test("the scanner is the default busy indicator", () => {
  const indicator = busyIndicator(undefined, color)
  expect(busyIndicator("scanner", color).frames).toEqual(indicator.frames)
  expect(indicator.interval).toBe(40)
  expect(indicator.frames.every((frame) => /^[■⬝]{8}$/.test(frame))).toBe(true)
  expect(typeof indicator.color).toBe("function")
})

test("the spinner busy indicator is the one-cell spinner, changing on every frame", () => {
  const indicator = busyIndicator("spinner", color)
  expect(indicator.frames).toEqual([...TuiLayout.Spinner.frames])
  expect(indicator.interval).toBe(TuiLayout.Spinner.interval)
  expect(indicator.color).toBe(color)
  expect(indicator.frames.every((frame, index, frames) => frame.length === 1 && frame !== frames[index - 1])).toBe(true)
})
