import { expect, test } from "bun:test"
import { collapseTail } from "../../src/util/collapse-tool-output"
import { collapseOutput } from "../../src/routes/session"

const output = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n")

test("collapseTail keeps v2's label and last lines", () => {
  expect(collapseTail(output, 4, 1000)).toBe("(27 earlier lines)\nline 28\nline 29\nline 30")
  expect(collapseTail("a\nb", 4, 1000)).toBe("a\nb")
  expect(collapseTail(output, 1, 1000)).toBe("(30 earlier lines)")
  expect(collapseTail("a\nb", 1, 1000)).toBe("(2 earlier lines)")
})

test("collapseOutput shows the head by default and the tail when asked", () => {
  expect(collapseOutput(output, 3, 80).output).toBe("line 1\nline 2\nline 3\n…")
  expect(collapseOutput(output, 3, 80, true)).toEqual({
    output: "(28 earlier lines)\nline 29\nline 30",
    overflow: true,
  })
  expect(collapseOutput("short", 3, 80, true)).toEqual({ output: "short", overflow: false })
  expect(collapseOutput(output, 0, 80, true)).toEqual({ output: "", overflow: true })
  expect(collapseOutput(output, undefined, 80, true)).toEqual({ output, overflow: false })
})
