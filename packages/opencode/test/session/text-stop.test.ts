import { describe, expect, test } from "bun:test"
import { textStop } from "../../src/session/text-stop"

describe("text stop sequences", () => {
  const sequences = ["\n## Reserved", "<begin-records>", "<end-records>"]
  for (const sequence of sequences) {
    for (let split = 0; split <= sequence.length; split++) {
      test(`suppresses sequence ${JSON.stringify(sequence)} split at ${split}`, () => {
        const matcher = textStop(sequences)
        const first = matcher.push("narrative" + sequence.slice(0, split))
        const second = matcher.push(sequence.slice(split) + "untrusted trailing data")
        expect(first.text + second.text + matcher.finish()).toBe("narrative")
        expect(second.stop).toBe(sequences.indexOf(sequence))
        expect(matcher.push("more text").text).toBe("")
      })
    }
  }

  test("holds only possible prefixes and flushes an unmatched suffix at EOF", () => {
    for (let prefix = 0; prefix < sequences[0].length; prefix++) {
      const matcher = textStop(sequences)
      const text = "narrative" + sequences[0].slice(0, prefix)
      const out = [...text].map((character) => matcher.push(character).text).join("")
      expect(out).toBe("narrative")
      expect(out + matcher.finish()).toBe(text)
      expect(matcher.finish()).toBe("")
    }
  })

  test("matches a newline-prefixed sequence at the start of output across all splits", () => {
    const heading = sequences[0].slice(1)
    for (let split = 0; split <= heading.length; split++) {
      const matcher = textStop(sequences)
      const first = matcher.push(heading.slice(0, split))
      const second = matcher.push(heading.slice(split) + "trailing data")
      expect(first.text + second.text + matcher.finish()).toBe("")
      expect(second.stop).toBe(0)
    }
  })

  test("does not treat a heading in ordinary inline prose as a line boundary", () => {
    const matcher = textStop(sequences)
    const text = "narrative ## Reserved is inline\n## Reserve is not a match"
    expect([...text].map((character) => matcher.push(character).text).join("") + matcher.finish()).toBe(text)
  })

  test("chooses the earliest literal occurrence rather than sequence order", () => {
    const matcher = textStop(["later", "first"])
    expect(matcher.push("safe first later")).toEqual({ text: "safe ", stop: 1 })
  })

  test("retains overlapping prefixes without losing safe text", () => {
    const matcher = textStop(["ababx", "abc"])
    const out = ["ab", "ab", "a", "bc hidden"].map((text) => matcher.push(text).text).join("")
    expect(out + matcher.finish()).toBe("abab")
  })

  test("empty policies pass text unchanged and empty sequences are rejected", () => {
    expect(textStop([]).push("unchanged")).toEqual({ text: "unchanged", stop: undefined })
    expect(() => textStop(["valid", ""])).toThrow(RangeError)
    expect(textStop(["\n"]).push("\ntrailing")).toEqual({ text: "", stop: 0 })
  })
})
