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

const color = RGBA.fromHex("#ffffff")
const colors = {
  indent: color,
  key: color,
  punctuation: color,
  string: color,
  number: color,
  boolean: color,
  null: color,
  fold: color,
}

const input = {
  questions: [
    {
      header: "Paste dialog v4",
      question:
        "Live as vt-233 on desktop and m4max (fork 00ea612cb9, PR #54463 updated). This tab has to restart before the dialog shows, and the other tabs pick it up the next time they start.",
      options: [
        { label: "Works", description: "Buttons, tab and hint behave as listed in the report" },
        { label: "Something's off", description: "Say what" },
      ],
    },
  ],
}

async function frame(width: number, collapsedWidth?: number) {
  setup?.renderer.destroy()
  const { rows } = formatToolInput(input, collapsedWidth)
  let reported: number | undefined
  setup = await testRender(
    () => (
      <box paddingLeft={3}>
        <ToolInput rows={rows} colors={colors} onWidth={(value) => (reported = value)} />
      </box>
    ),
    { width, height: 30 },
  )
  await setup.renderOnce()
  const lines = setup
    .captureCharFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
  return { lines, reported }
}

for (const width of [40, 80, 160]) {
  test(`collapsed at ${width} columns, every value fills exactly one row`, async () => {
    const measured = (await frame(width)).reported!
    expect(measured).toBe(width - 3)
    const { lines } = await frame(width, measured)
    expect(lines.map((line) => line.trimStart().split(":")[0])).toEqual([
      "questions",
      "- header",
      "question",
      "options",
      "- label",
      "description",
      "- label",
      "description",
    ])
    expect(lines.every((line) => Bun.stringWidth(line) <= width)).toBe(true)
    expect(lines[2]).toEndWith("…")
    expect(lines[2].startsWith("     question: Live as vt-233")).toBe(true)
  })
}

test("expanded, wraps long values and keeps compact YAML indents", async () => {
  const { lines } = await frame(80)
  expect(lines.slice(0, 3)).toEqual([
    "   questions:",
    "   - header: Paste dialog v4",
    "     question: Live as vt-233 on desktop and m4max (fork 00ea612cb9, PR #54463",
  ])
  expect(lines.length).toBeGreaterThan(8)
})

const browser = {
  action: "run",
  name: "main",
  timeout: 30,
  code: "const rows = [...document.querySelectorAll('table.identifiers tr')].map((row) => row.innerText.trim());\nreturn { url: location.pathname, rows }",
}
const browserOutput = {
  url: "/account/resources/identifiers/list/bundleId/add/bundle-with-a-very-long-identifier-name",
  els: ['- checkbox "App Attest" [checked] [ref=e12]', '- checkbox "Push Notifications" [] [ref=e13]'],
  note: "first line\nsecond line",
  ok: true,
}

async function rowsFrame(width: number, rows: ReturnType<typeof formatToolInput>["rows"]) {
  setup?.renderer.destroy()
  setup = await testRender(
    () => (
      <box paddingLeft={3}>
        <ToolInput rows={rows} colors={colors} />
      </box>
    ),
    { width, height: 30 },
  )
  await setup.renderOnce()
  return setup
    .captureCharFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
}

for (const width of [40, 80, 160]) {
  test(`a 4-key browser call collapsed to 4 rows at ${width} columns, the code cut to one`, async () => {
    const lines = await rowsFrame(width, formatToolInput(browser, width - 3, 4).rows)
    expect(lines.map((line) => line.trimStart().split(":")[0])).toEqual(["action", "name", "timeout", "code"])
    if (width < 160) expect(lines[3]).toEndWith("…")
    else expect(lines[3]).toEndWith("return { url: location.pathname, rows }")
    expect(lines.every((line) => Bun.stringWidth(line) <= width)).toBe(true)
  })

  test(`JSON output as YAML rows, at most 5 and one row each, at ${width} columns`, async () => {
    const collapsed = formatToolInput(browserOutput, width - 3, 5)
    expect(collapsed.overflow).toBe(true)
    const lines = await rowsFrame(width, collapsed.rows)
    expect(lines.map((line) => line.trimStart().split(":")[0].split(" [")[0])).toEqual([
      "url",
      "els",
      '- - checkbox "App Attest"',
      '- - checkbox "Push Notifications"',
      "note",
    ])
    expect(lines.every((line) => Bun.stringWidth(line) <= width)).toBe(true)
  })
}

test("JSON output as YAML rows, expanded, shows a multi-line string on its own lines", async () => {
  const lines = await rowsFrame(160, formatToolInput(browserOutput).rows)
  expect(lines.slice(-4)).toEqual(["   note:", "     first line", "     second line", "   ok: true"])
})
