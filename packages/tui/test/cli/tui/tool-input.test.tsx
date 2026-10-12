import { afterEach, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { ToolInput } from "../../../src/routes/session"
import { formatToolInput } from "../../../src/util/tool-input"

let setup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  setup?.renderer.destroy()
  setup = undefined
})

test("draws one row per key with nested values indented", async () => {
  const color = RGBA.fromHex("#ffffff")
  const { rows } = formatToolInput(
    { query: "select 1", options: { tags: ["a", "b"] }, body: "one\ntwo" },
    (output) => ({ output, overflow: false }),
  )
  setup = await testRender(
    () => (
      <ToolInput
        rows={rows}
        colors={{
          indent: color,
          key: color,
          punctuation: color,
          string: color,
          number: color,
          boolean: color,
          null: color,
          fold: color,
        }}
      />
    ),
    { width: 60, height: 12 },
  )
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  expect(frame.split("\n").map((line) => line.trimEnd()).filter(Boolean)).toEqual([
    "query: select 1",
    "options:",
    "  tags:",
    "    - a",
    "    - b",
    "body:",
    "  one",
    "  two",
  ])
})
