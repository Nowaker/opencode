import { describe, expect, test } from "bun:test"
import { TuiLayout } from "../src/layout"

describe("prompt sizes", () => {
  test("a percentage is of the space, at least 1, and a count stays a count", () => {
    expect(TuiLayout.size("80%", 20)).toBe(16)
    expect(TuiLayout.size("100%", 20)).toBe(20)
    expect(TuiLayout.size("1%", 20)).toBe(1)
    expect(TuiLayout.size(12, 20)).toBe(12)
    expect(TuiLayout.size(undefined, 20)).toBeUndefined()
  })

  test("the home prompt's max width takes columns, 'auto' or a percentage of the home column", () => {
    expect(TuiLayout.homePromptMaxWidth(undefined, 200)).toBe(75)
    expect(TuiLayout.homePromptMaxWidth(90, 200)).toBe(90)
    expect(TuiLayout.homePromptMaxWidth("auto", 200)).toBe(140)
    expect(TuiLayout.homePromptMaxWidth("50%", 204)).toBe(100)
  })

  test("the text area starts at min_height and grows to max_height, never past the space", () => {
    expect(TuiLayout.promptRows({ terminalHeight: 30 })).toEqual({ min: 1, max: 10 })
    expect(TuiLayout.promptRows({ terminalHeight: 12 })).toEqual({ min: 1, max: 6 })
    expect(TuiLayout.promptRows({ terminalHeight: 30, space: 4 })).toEqual({ min: 1, max: 4 })
    expect(TuiLayout.promptRows({ max: 999, terminalHeight: 30 })).toEqual({ min: 1, max: 999 })
    expect(TuiLayout.promptRows({ max: 999, terminalHeight: 30, space: 21 })).toEqual({ min: 1, max: 21 })
    expect(TuiLayout.promptRows({ min: 5, max: "50%", terminalHeight: 30, space: 20 })).toEqual({ min: 5, max: 10 })
    expect(TuiLayout.promptRows({ min: "25%", max: "80%", terminalHeight: 30, space: 20 })).toEqual({ min: 5, max: 16 })
    expect(TuiLayout.promptRows({ min: 30, terminalHeight: 30, space: 20 })).toEqual({ min: 10, max: 10 })
    // Too little room still leaves one row to type in.
    expect(TuiLayout.promptRows({ terminalHeight: 8, space: -3 })).toEqual({ min: 1, max: 1 })
  })

  test("the prompt's space leaves the logo, the row above it, the notice and the padding", () => {
    expect(TuiLayout.homePromptSpace({ height: 27, logo: 4, notice: 0 })).toBe(21)
    expect(TuiLayout.homePromptSpace({ height: 27, logo: 0, notice: 1 })).toBe(25)
    expect(TuiLayout.sessionPromptSpace(30)).toBe(28)
  })
})

describe("home stack", () => {
  const stack = (input: Partial<Parameters<typeof TuiLayout.homeStack>[0]>) =>
    TuiLayout.homeStack({ height: 27, logo: 4, prompt: 7, bottom: 4, position: "middle", ...input })

  test("with room to spare the middle prompt is centered and top/bottom keep one row above the logo", () => {
    expect(stack({})).toEqual({ spacer: 3.5, gapAbove: 4, gapBelow: 1, bottom: 4 })
    expect(stack({ position: "top" })).toEqual({ spacer: 0, gapAbove: 1, gapBelow: 1, bottom: 4 })
    expect(stack({ position: "bottom" })).toEqual({ spacer: 10, gapAbove: 1, gapBelow: 1, bottom: 4 })
  })

  test("a tall prompt shrinks the gaps and tips, the gap above the logo to one row", () => {
    expect(stack({ prompt: 22 })).toEqual({ spacer: 0, gapAbove: 1, gapBelow: 0, bottom: 0 })
    expect(stack({ prompt: 16 })).toEqual({ spacer: 0.5, gapAbove: 3, gapBelow: 0, bottom: 3 })
    for (const position of ["middle", "top", "bottom"] as const)
      for (let prompt = 7; prompt <= 22; prompt++) {
        const result = stack({ prompt, position })
        expect(result.gapAbove).toBeGreaterThanOrEqual(1)
        expect(result.gapAbove + 4 + result.gapBelow + prompt + result.bottom).toBeLessThanOrEqual(27)
      }
  })

  test("without the logo there are no gaps", () => {
    expect(stack({ logo: 0, prompt: 20 })).toEqual({ spacer: 1.5, gapAbove: 0, gapBelow: 0, bottom: 4 })
    expect(stack({ logo: 0, prompt: 27 })).toEqual({ spacer: 0, gapAbove: 0, gapBelow: 0, bottom: 0 })
  })

  test("the tips toggle wins over home.tips", () => {
    expect(TuiLayout.homeTipsShown({})).toBe(true)
    expect(TuiLayout.homeTipsShown({ configured: false })).toBe(false)
    expect(TuiLayout.homeTipsShown({ kv: false, configured: false })).toBe(true)
    expect(TuiLayout.homeTipsShown({ kv: true, configured: true })).toBe(false)
  })
})
