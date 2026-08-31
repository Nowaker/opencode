import { describe, expect, test } from "bun:test"
import { displayCharAt, displaySlice, mentionTriggerIndex, promptOffsetWidth } from "../../src/prompt/display"

// These helpers are the straightforward definition of the display-offset arithmetic:
// segment every grapheme, add up its width. The shipped versions skip whole runs of
// printable ASCII to keep a keystroke off the whole-buffer path, so they are checked
// against this definition rather than against hand-written expectations.
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

function referenceWidth(value: string) {
  let width = 0
  for (const part of graphemes.segment(value)) {
    width += part.segment === "\n" ? 1 : Bun.stringWidth(part.segment)
  }
  return width
}

function referenceOffsetIndex(value: string, offset: number) {
  if (offset <= 0) return 0
  let width = 0
  for (const part of graphemes.segment(value)) {
    const next = width + referenceWidth(part.segment)
    if (next > offset) return part.index
    width = next
  }
  return value.length
}

function referenceCharAt(value: string, offset: number) {
  let width = 0
  for (const part of graphemes.segment(value)) {
    const next = width + referenceWidth(part.segment)
    if (offset === width || offset < next) return part.segment
    width = next
  }
}

function referenceMentionTriggerIndex(value: string, offset: number) {
  const text = value.slice(referenceOffsetIndex(value, 0), referenceOffsetIndex(value, offset))
  const index = text.lastIndexOf("@")
  if (index === -1) return

  const before = index === 0 ? undefined : text[index - 1]
  const query = text.slice(index)
  if ((before === undefined || /\s/.test(before)) && !/\s/.test(query)) {
    return referenceWidth(text.slice(0, index))
  }
}

describe("prompt display", () => {
  test("uses display-width offsets for mentions", () => {
    expect(mentionTriggerIndex("@")).toBe(0)
    expect(mentionTriggerIndex("test @")).toBe(5)
    expect(mentionTriggerIndex("中文 @")).toBe(5)
    expect(mentionTriggerIndex("こんにちは @")).toBe(11)
    expect(mentionTriggerIndex("한국어 @")).toBe(7)
    expect(mentionTriggerIndex("🙂 @")).toBe(3)
    expect(mentionTriggerIndex("中文 @src file", Bun.stringWidth("中文 @src"))).toBe(5)
    expect(displayCharAt("中文 @src", Bun.stringWidth("中文 @"))).toBe("s")
    expect(displaySlice("中文 @src", 5, Bun.stringWidth("中文 @src"))).toBe("@src")
    expect(displaySlice("中文 @src", 6, Bun.stringWidth("中文 @src"))).toBe("src")
    expect(mentionTriggerIndex("👨‍👩‍👧‍👦 @src", Bun.stringWidth("👨‍👩‍👧‍👦 @src"))).toBe(3)
    expect(displayCharAt("👨‍👩‍👧‍👦 @src", Bun.stringWidth("👨‍👩‍👧‍👦 @"))).toBe("s")
    expect(displaySlice("👨‍👩‍👧‍👦 @src", 3, Bun.stringWidth("👨‍👩‍👧‍👦 @src"))).toBe("@src")
    expect(mentionTriggerIndex("@file1\n@file2", 13)).toBe(7)
    expect(displayCharAt("@file1\n@file2", 6)).toBe("\n")
    expect(displaySlice("@file1\n@file2", 8, 13)).toBe("file2")
    expect(mentionTriggerIndex("@file1\nfoo @file2", 17)).toBe(11)
    expect(mentionTriggerIndex("中文 @one\n@two", 14)).toBe(10)
    expect(displaySlice("中文 @one\n@two", 11, 14)).toBe("two")
    expect(mentionTriggerIndex("中文@")).toBeUndefined()
    expect(mentionTriggerIndex("こんにちは@")).toBeUndefined()
    expect(mentionTriggerIndex("한국어@")).toBeUndefined()
    expect(mentionTriggerIndex("🙂@")).toBeUndefined()
    expect(mentionTriggerIndex("hello@")).toBeUndefined()
    expect(mentionTriggerIndex("foo@bar.com")).toBeUndefined()
    expect(mentionTriggerIndex("中文 @src file")).toBeUndefined()
  })

  test("matches grapheme-by-grapheme arithmetic at every offset", () => {
    const samples = [
      "",
      "@",
      "hello world",
      "plain ascii then a mention @src/file.ts",
      "中文 @one\n@two",
      "こんにちは @src",
      "🙂 @src",
      "👨‍👩‍👧‍👦 @src",
      "e\u0301 @src",
      "cafe\u0301 @src/file.ts",
      "ascii tail e\u0301",
      "a\u0301bc",
      "line one\nline two @src\nline three",
      "foo@bar.com and @real",
      "@a@b",
      "trailing space @src ",
      "tab\tseparated @src",
    ]

    for (const value of samples) {
      expect(promptOffsetWidth(value)).toBe(referenceWidth(value))
      for (let offset = 0; offset <= referenceWidth(value) + 2; offset++) {
        expect([value, offset, mentionTriggerIndex(value, offset)]).toEqual([
          value,
          offset,
          referenceMentionTriggerIndex(value, offset),
        ])
        expect([value, offset, displayCharAt(value, offset)]).toEqual([
          value,
          offset,
          referenceCharAt(value, offset),
        ])
        expect([value, offset, displaySlice(value, 0, offset)]).toEqual([
          value,
          offset,
          value.slice(0, referenceOffsetIndex(value, offset)),
        ])
      }
    }
  })
})
