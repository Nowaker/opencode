import { describe, expect, test } from "bun:test"
import { StartupEditor } from "../../src/startup/editor"
import { StartupFrame } from "../../src/startup/frame"

const measure = (segment: string) => Bun.stringWidth(segment)
const key = (name: string, modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; super?: boolean } = {}) => ({
  name,
  ctrl: modifiers.ctrl ?? false,
  alt: modifiers.alt ?? false,
  shift: modifiers.shift ?? false,
  super: modifiers.super ?? false,
})

describe("startup editor", () => {
  test("moves and deletes whole graphemes", () => {
    const editor = StartupEditor.create({ measure })
    editor.insert("ae\u0301👩‍💻")
    editor.key(key("backspace"), 40)
    expect(editor.text).toBe("ae\u0301")
    editor.key(key("left"), 40)
    expect(editor.caret).toBe(1)
    editor.key(key("delete"), 40)
    expect(editor.text).toBe("a")
  })

  test("a backward Shift selection keeps its anchor and is replaced by typing", () => {
    const editor = StartupEditor.create({ text: "hello world", measure })
    editor.key(key("left", { shift: true }), 40)
    editor.key(key("left", { shift: true }), 40)
    expect(editor.snapshot()).toMatchObject({ caret: 9, anchor: 11, touched: true })
    editor.key(key("z", { shift: true }), 40)
    expect(editor.text).toBe("hello worZ")
  })

  test("an untouched seed reports untouched", () => {
    const editor = StartupEditor.create({ text: "seed", measure })
    expect(editor.snapshot()).toEqual({ text: "seed", caret: 4, anchor: 4, touched: false, submit: false })
  })

  test("Enter marks the current text for submission until the text changes", () => {
    const editor = StartupEditor.create({ measure })
    editor.insert("ship")
    editor.key(key("return"), 40)
    expect(editor.snapshot().submit).toBe(true)
    editor.key(key("left"), 40)
    expect(editor.snapshot().submit).toBe(true)
    editor.insert("!")
    expect(editor.snapshot().submit).toBe(false)
  })

  test("paste keeps line breaks and Ctrl+C asks to quit", () => {
    const editor = StartupEditor.create({ measure })
    editor.paste("one\r\ntwo\rthree")
    expect(editor.text).toBe("one\ntwo\nthree")
    expect(editor.key(key("c", { ctrl: true }), 40)).toBe("quit")
    expect(editor.text).toBe("one\ntwo\nthree")
  })

  test("vertical movement follows the wrapped layout", () => {
    const editor = StartupEditor.create({ text: "first line\nsecond", measure })
    editor.key(key("up"), 40)
    expect(editor.caret).toBe(6)
    editor.key(key("down"), 40)
    expect(editor.caret).toBe(17)
  })
})

describe("startup frame", () => {
  test("pasted control characters are drawn as symbols, never sent to the terminal", () => {
    const text = "a\x1b[2Jb\x07c"
    const frame = StartupFrame.render({
      route: "home",
      width: 60,
      height: 20,
      text,
      caret: text.length,
      anchor: text.length,
      measure,
    })
    expect(frame).not.toContain("\x1b[2J")
    expect(frame).not.toContain("\x07")
    expect(frame).toContain("a\u241b[2Jb\u2407c")
  })
})
