import { describe, expect, test } from "bun:test"
import { fitsInline, formatToolInput, inlineToolInput, type ToolInputRow } from "../../src/util/tool-input"

const whole = (output: string) => ({ output, overflow: false })
const text = (rows: ToolInputRow[]) => rows.map((row) => row.map((segment) => segment.text).join(""))

describe("fitsInline", () => {
  test("keeps short primitive input on one line", () => {
    expect(fitsInline({ query: "opencode", limit: 5, exact: true })).toBe(true)
    expect(fitsInline({})).toBe(true)
  })

  test("sends nested, multi-line, null or long input to a block", () => {
    expect(fitsInline({ options: { limit: 5 } })).toBe(false)
    expect(fitsInline({ tags: ["a"] })).toBe(false)
    expect(fitsInline({ body: "one\ntwo" })).toBe(false)
    expect(fitsInline({ cursor: null })).toBe(false)
    expect(fitsInline({ prompt: "x".repeat(80) })).toBe(false)
  })

  test("measures the one-line form", () => {
    expect(inlineToolInput({ a: 1, b: "two", c: { d: 1 } })).toBe("[a=1, b=two]")
    expect(inlineToolInput({ a: 1, b: 2 }, ["a"])).toBe("[b=2]")
  })
})

describe("formatToolInput", () => {
  test("writes one key per row, nesting objects and arrays YAML-style", () => {
    const { rows, overflow } = formatToolInput(
      {
        query: "select 1",
        limit: 10,
        exact: false,
        cursor: null,
        options: { tags: ["a", 2], deep: { on: true } },
        items: [{ name: "x", id: 1 }, [], {}],
        empty: "",
      },
      whole,
    )
    expect(overflow).toBe(false)
    expect(text(rows)).toEqual([
      "query: select 1",
      "limit: 10",
      "exact: false",
      "cursor: null",
      "options:",
      "  tags:",
      "    - a",
      "    - 2",
      "  deep:",
      "    on: true",
      "items:",
      "  - name: x",
      "    id: 1",
      "  - []",
      "  - {}",
      'empty: ""',
    ])
  })

  test("shows strings unquoted with their newlines, tabs and quotes as real characters", () => {
    const { rows } = formatToolInput(JSON.parse('{"body":"say \\"hi\\"\\n\\tindented","title":"a \\"b\\""}'), whole)
    expect(text(rows)).toEqual(["body:", '  say "hi"', "  \tindented", 'title: a "b"'])
  })

  test("indents a multi-line string inside an array element", () => {
    const { rows } = formatToolInput({ steps: ["one\ntwo"] }, whole)
    expect(text(rows)).toEqual(["steps:", "  -", "    one", "    two"])
  })

  test("colors keys and values by type", () => {
    const { rows } = formatToolInput({ a: "s", b: 1, c: true, d: null }, whole)
    expect(rows.map((row) => row.map((segment) => segment.kind))).toEqual([
      ["indent", "key", "punctuation", "string"],
      ["indent", "key", "punctuation", "number"],
      ["indent", "key", "punctuation", "boolean"],
      ["indent", "key", "punctuation", "null"],
    ])
  })

  test("folds long strings and reports it", () => {
    const fold = (output: string) =>
      output.includes("\n") ? { output: output.split("\n")[0] + "\n…", overflow: true } : whole(output)
    const { rows, overflow } = formatToolInput({ body: "one\ntwo\nthree", short: "x" }, fold)
    expect(overflow).toBe(true)
    expect(text(rows)).toEqual(["body:", "  one", "  …", "short: x"])
  })

  test("shows an ellipsis for a string folded away entirely", () => {
    const { rows, overflow } = formatToolInput({ body: "text" }, () => ({ output: "", overflow: true }))
    expect(overflow).toBe(true)
    expect(text(rows)).toEqual(["body: …"])
    expect(rows[0].at(-1)?.kind).toBe("fold")
  })
})
