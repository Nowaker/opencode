import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { InstantEditor } from "../../src/instant/editor"
import { InstantKeys } from "../../src/instant/keys"
import { createParity } from "./parity"

const width = 12
const samples = [
  "hello world foo",
  "one two\nthree  four five six\n\nlast-line/with.stuff end",
  "  lead space, trailing   ",
  "verylongwordwithoutbreaks and more",
  // Not a three-line [text, empty, text] buffer: opentui's deleteLine on its
  // last line also drops the empty line and puts the caret at 0, a quirk the
  // instant editor does not copy.
  "x.y-z/w q\nmid\n\nfoo(bar)",
  "",
]
const actions = [
  "newline",
  "move_left",
  "move_right",
  "move_up",
  "move_down",
  "select_left",
  "select_right",
  "select_up",
  "select_down",
  "line_home",
  "line_end",
  "select_line_home",
  "select_line_end",
  "visual_line_home",
  "visual_line_end",
  "select_visual_line_home",
  "select_visual_line_end",
  "buffer_home",
  "buffer_end",
  "select_buffer_home",
  "select_buffer_end",
  "delete_line",
  "delete_to_line_end",
  "delete_to_line_start",
  "backspace",
  "delete",
  "word_forward",
  "word_backward",
  "select_word_forward",
  "select_word_backward",
  "delete_word_forward",
  "delete_word_backward",
  "select_all",
] as const

describe("instant editor matches opentui's textarea", () => {
  let parity: Awaited<ReturnType<typeof createParity>>
  beforeAll(async () => {
    parity = await createParity(width)
  })
  afterAll(() => parity.destroy())

  test("every editing action from every caret position", async () => {
    const mismatches: string[] = []
    for (const text of samples) {
      for (let caret = 0; caret <= text.length; caret++) {
        for (const action of actions) {
          const result = await parity.run(text, caret, action)
          if (JSON.stringify(result.expected) !== JSON.stringify(result.actual))
            mismatches.push(`${action} ${JSON.stringify(text)}@${caret}: ${JSON.stringify(result)}`)
        }
      }
    }
    expect(mismatches).toEqual([])
  })

  test("word wrap and caret placement", async () => {
    for (const text of [...samples, "a".repeat(30), "ab  cd  ef  gh  ij"]) {
      const lines = InstantEditor.layout(text, width)
      const rendered = (await parity.lines(text)).slice(0, lines.length)
      expect(lines.map((line) => text.slice(line.start, line.cells.at(-1)?.end ?? line.start).trimEnd())).toEqual(
        rendered,
      )
      for (let caret = 0; caret <= text.length; caret++) {
        expect(InstantEditor.caretPosition(lines, caret)).toEqual(await parity.cursor(text, caret))
      }
    }
  })
})

describe("instant editor", () => {
  test("typing coalesces into one undo step and redo restores it", () => {
    const editor = InstantEditor.create()
    for (const char of "hello") editor.insert(char)
    editor.insert(" ")
    editor.apply("undo", width)
    expect(editor.text).toBe("")
    editor.apply("redo", width)
    expect(editor.text).toBe("hello ")
  })

  test("typing replaces a selection", () => {
    const editor = InstantEditor.create({ text: "hello world", caret: 6 })
    editor.apply("select_word_forward", width)
    editor.insert("there")
    expect(editor.text).toBe("hello there")
    expect(editor.caret).toBe(11)
  })

  test("a click moves the caret to the clicked cell across wrapped and logical lines", () => {
    const editor = InstantEditor.create({ text: "hello world foo\nbar" })
    const lines = InstantEditor.layout(editor.text, width)
    editor.click(lines, 1, 1)
    expect(editor.caret).toBe(13)
    editor.click(lines, 2, 9)
    expect(editor.caret).toBe(19)
    editor.click(lines, 0, 2)
    expect(editor.caret).toBe(2)
    editor.click(lines, 0, 30)
    expect(editor.caret).toBe(11)
  })

  test("a shift-click extends the selection from the caret", () => {
    const editor = InstantEditor.create({ text: "hello world", caret: 2 })
    const lines = InstantEditor.layout(editor.text, 40)
    editor.click(lines, 0, 8, true)
    expect(editor.selection()).toEqual({ start: 2, end: 8 })
  })
})

describe("instant keybinds", () => {
  test("defaults follow keybind.ts", () => {
    const table = InstantEditor.bindings()
    expect(InstantEditor.match(table, InstantKeys.key("a", { ctrl: true }))).toBe("line_home")
    expect(InstantEditor.match(table, InstantKeys.key("w", { ctrl: true }))).toBe("delete_word_backward")
    expect(InstantEditor.match(table, InstantKeys.key("return", { shift: true }))).toBe("newline")
    expect(InstantEditor.match(table, InstantKeys.key("j", { ctrl: true }))).toBe("newline")
    expect(InstantEditor.match(table, InstantKeys.key("return"))).toBe("submit")
    expect(InstantEditor.match(table, InstantKeys.key("home"))).toBe("buffer_home")
  })

  test("tui.json overrides replace the default strokes", () => {
    const table = InstantEditor.bindings({ input_line_home: "ctrl+a,home", input_buffer_home: "none" })
    expect(InstantEditor.match(table, InstantKeys.key("home"))).toBe("line_home")
    expect(InstantEditor.match(table, InstantKeys.key("a", { ctrl: true }))).toBe("line_home")
  })

  test("binding specs parse like keybind.ts writes them", () => {
    expect(InstantEditor.parseBinding("ctrl+shift+a,<leader>x,super+z")).toEqual([
      InstantKeys.key("a", { ctrl: true, shift: true }),
      InstantKeys.key("z", { super: true }),
    ])
    expect(InstantEditor.parseBinding({ key: "ctrl+v", preventDefault: false })).toEqual([
      InstantKeys.key("v", { ctrl: true }),
    ])
    expect(InstantEditor.parseBinding("ctrl+-")).toEqual([InstantKeys.key("-", { ctrl: true })])
    expect(InstantEditor.parseBinding(false)).toEqual([])
  })
})
