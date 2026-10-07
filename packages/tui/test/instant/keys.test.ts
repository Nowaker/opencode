import { describe, expect, test } from "bun:test"
import { InstantKeys } from "../../src/instant/keys"

const bytes = (text: string) => new TextEncoder().encode(text)
const parse = (...chunks: string[]) => {
  const parser = InstantKeys.createParser()
  return chunks.flatMap((chunk) => parser.feed(bytes(chunk)))
}
const key = InstantKeys.key

describe("instant key parser", () => {
  test("text runs, control bytes and legacy Enter", () => {
    expect(parse("héllo\r\x7f\x17\x01")).toEqual([
      { type: "text", text: "héllo" },
      { type: "key", key: key("return") },
      { type: "key", key: key("backspace") },
      { type: "key", key: key("w", { ctrl: true }) },
      { type: "key", key: key("a", { ctrl: true }) },
    ])
  })

  test("line feed reads as ctrl+j", () => {
    expect(parse("\n")).toEqual([{ type: "key", key: key("j", { ctrl: true }) }])
  })

  test("cursor keys with and without modifiers", () => {
    expect(parse("\x1b[D\x1b[1;5C\x1b[H\x1bOF\x1b[3~\x1b[1;2H")).toEqual([
      { type: "key", key: key("left") },
      { type: "key", key: key("right", { ctrl: true }) },
      { type: "key", key: key("home") },
      { type: "key", key: key("end") },
      { type: "key", key: key("delete") },
      { type: "key", key: key("home", { shift: true }) },
    ])
  })

  test("kitty CSI u and xterm modifyOtherKeys", () => {
    expect(parse("\x1b[13;2u\x1b[97;5u\x1b[27;2;13~\x1b[27u\x1b[65;1:3u")).toEqual([
      { type: "key", key: key("return", { shift: true }) },
      { type: "key", key: key("a", { ctrl: true }) },
      { type: "key", key: key("return", { shift: true }) },
      { type: "key", key: key("escape") },
    ])
  })

  test("alt prefixes", () => {
    expect(parse("\x1bb\x1b\r\x1b\x7f")).toEqual([
      { type: "key", key: key("b", { alt: true }) },
      { type: "key", key: key("return", { alt: true }) },
      { type: "key", key: key("backspace", { alt: true }) },
    ])
  })

  test("SGR mouse press, drag and release in zero-based cells", () => {
    expect(parse("\x1b[<0;5;3M\x1b[<32;6;3M\x1b[<0;6;3m\x1b[<64;1;1M")).toEqual([
      { type: "mouse", button: 0, x: 4, y: 2, action: "press" },
      { type: "mouse", button: 0, x: 5, y: 2, action: "drag" },
      { type: "mouse", button: 0, x: 5, y: 2, action: "release" },
      { type: "mouse", button: 64, x: 0, y: 0, action: "wheel" },
    ])
  })

  test("bracketed paste keeps newlines and spans chunks", () => {
    expect(parse("\x1b[200~line one\r\nline", " two\x1b[20", "1~x")).toEqual([
      { type: "paste", text: "line one\r\nline two" },
      { type: "text", text: "x" },
    ])
  })

  test("sequences split across reads wait for their end", () => {
    const parser = InstantKeys.createParser()
    expect(parser.feed(bytes("ab\x1b[1;"))).toEqual([{ type: "text", text: "ab" }])
    expect(parser.pending()).toBe("\x1b[1;")
    expect(parser.feed(bytes("5D"))).toEqual([{ type: "key", key: key("left", { ctrl: true }) }])
    expect(parser.pending()).toBe("")
  })

  test("a lone Escape is held until flushed", () => {
    const parser = InstantKeys.createParser()
    expect(parser.feed(bytes("\x1b"))).toEqual([])
    expect(parser.flush()).toEqual([{ type: "key", key: key("escape") }])
  })

  test("terminal replies are skipped", () => {
    expect(parse("\x1b]11;rgb:0000/0000/0000\x07\x1bP>|kitty\x1b\\\x1b[?1u")).toEqual([])
  })
})
