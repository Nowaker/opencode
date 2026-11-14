import { describe, expect, test } from "bun:test"
import { StartupInputBytes } from "../../src/startup/input"
import { StartupIntake } from "../../src/startup/intake"

const bytes = (text: string) => new TextEncoder().encode(text)

function intake() {
  const tokens: StartupInputBytes.Token[] = []
  const owner = StartupIntake.create((token) => {
    tokens.push(token)
  })
  return { owner, tokens }
}

describe("startup input intake", () => {
  test("joins a UTF-8 character split across reads", () => {
    const { owner, tokens } = intake()
    const cjk = bytes("日")
    expect(owner.push(cjk.subarray(0, 1))).toBeUndefined()
    expect(owner.push(cjk.subarray(1, 2))).toBeUndefined()
    expect(tokens).toEqual([])
    owner.push(cjk.subarray(2))
    expect(tokens).toEqual([{ type: "text", text: "日" }])
  })

  test("an idle cutoff stops at once and keeps every later byte raw and in order", () => {
    const { owner, tokens } = intake()
    owner.push(bytes("ab"))
    expect(owner.request()).toBe("stopped")
    // Invalid UTF-8 and a split character must reach the renderer exactly as read, never decoded and re-encoded.
    const later = Uint8Array.of(0xff, 0x41, 0xe6, 0x97)
    expect(owner.push(later)).toBeUndefined()
    expect(tokens).toEqual([{ type: "text", text: "ab" }])
    expect([...owner.rest()]).toEqual([...later])
  })

  test("a cutoff inside a split character finishes that character and leaves the rest unparsed", () => {
    const { owner, tokens } = intake()
    const cjk = bytes("日")
    owner.push(cjk.subarray(0, 2))
    expect(owner.request()).toBeUndefined()
    expect(owner.push(Uint8Array.of(...cjk.subarray(2), ...bytes("xyz")))).toBe("stopped")
    expect(tokens).toEqual([{ type: "text", text: "日" }])
    expect(new TextDecoder().decode(owner.rest())).toBe("xyz")
  })

  test("a cutoff inside a CSI key finishes the key", () => {
    const { owner, tokens } = intake()
    owner.push(bytes("\x1b[1;2"))
    expect(owner.request()).toBeUndefined()
    expect(owner.push(bytes("D\x1b[C"))).toBe("stopped")
    expect(tokens).toEqual([{ type: "key", key: { name: "left", ctrl: false, alt: false, shift: true, super: false } }])
    expect(new TextDecoder().decode(owner.rest())).toBe("\x1b[C")
  })

  test("a cutoff inside a bracketed paste finishes the paste", () => {
    const { owner, tokens } = intake()
    // The end marker arrives split, so the paste completes only on its final byte.
    owner.push(bytes("\x1b[200~line one\nline two\x1b[20"))
    expect(owner.request()).toBeUndefined()
    expect(tokens).toEqual([])
    expect(owner.push(bytes("1~after"))).toBe("stopped")
    expect(tokens).toEqual([{ type: "paste", text: "line one\nline two" }])
    expect(new TextDecoder().decode(owner.rest())).toBe("after")
  })

  test("a kitty key release is consumed without a key", () => {
    const { owner, tokens } = intake()
    owner.push(bytes("\x1b[97;1:3u\x1b[97u"))
    expect(tokens).toEqual([
      { type: "ignore" },
      { type: "key", key: { name: "a", ctrl: false, alt: false, shift: false, super: false } },
    ])
  })

  test("a lone Escape waits for its own deadline across a cutoff", () => {
    const { owner, tokens } = intake()
    owner.push(bytes("\x1b"))
    expect(owner.escapePending).toBe(true)
    expect(owner.request()).toBeUndefined()
    expect(owner.flushEscape()).toBe("stopped")
    expect(tokens).toEqual([
      { type: "key", key: { name: "escape", ctrl: false, alt: false, shift: false, super: false } },
    ])
  })

  test("an Escape extended before its deadline becomes the sequence", () => {
    const { owner, tokens } = intake()
    owner.push(bytes("\x1b"))
    owner.push(bytes("[A"))
    expect(owner.escapePending).toBe(false)
    expect(owner.flushEscape()).toBeUndefined()
    expect(tokens).toEqual([{ type: "key", key: { name: "up", ctrl: false, alt: false, shift: false, super: false } }])
  })

  test.each([
    { name: "a kitty key beyond Unicode", sequence: "\x1b[99999999u" },
    { name: "a kitty key naming a surrogate", sequence: "\x1b[55296u" },
    { name: "a modifyOtherKeys key beyond Unicode", sequence: "\x1b[27;1;99999999~" },
  ])("$name is dropped and the stream goes on", (input) => {
    const { owner, tokens } = intake()
    owner.push(bytes(`${input.sequence}a`))
    expect(tokens).toEqual([{ type: "ignore" }, { type: "text", text: "a" }])
  })

  test("modifyOtherKeys and Ctrl+C reach the editor as keys", () => {
    const { owner, tokens } = intake()
    owner.push(bytes("\x1b[27;2;13~\x03"))
    expect(tokens).toEqual([
      { type: "key", key: { name: "return", ctrl: false, alt: false, shift: true, super: false } },
      { type: "key", key: { name: "c", ctrl: true, alt: false, shift: false, super: false } },
    ])
  })
})
