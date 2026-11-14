import { describe, expect, test } from "bun:test"
import { capDiff } from "../../src/tool/edit"

describe("capDiff", () => {
  test("preserves diffs at the byte limit", () => {
    const diff = "header\n+unchanged preview\n"
    expect(capDiff(diff, Buffer.byteLength(diff))).toBe(diff)
  })

  for (const ending of ["", "\n"]) {
    test(`reports exact omitted UTF-8 bytes and lines ${ending ? "with" : "without"} a final newline`, () => {
      const diff = "@@ -0,0 +1,200 @@\n" + ("+" + "\u{1f600}".repeat(10) + "\n").repeat(199) + "+last" + ending
      const capped = capDiff(diff, 256)
      const marker = capped.match(/\.\.\. diff truncated: (\d+) bytes, (\d+) lines not stored\n$/)
      expect(marker).not.toBeNull()
      if (!marker || marker.index === undefined) throw new Error("missing truncation marker")
      const head = capped.slice(0, marker.index)
      const omitted = diff.slice(head.length)

      expect(Buffer.byteLength(capped)).toBeLessThanOrEqual(256)
      expect(head.endsWith("\n")).toBe(true)
      expect(diff.startsWith(head)).toBe(true)
      expect(head).not.toContain("\ufffd")
      expect(Number(marker[1])).toBe(Buffer.byteLength(omitted))
      expect(Number(marker[2])).toBe(omitted.split("\n").length - (ending ? 1 : 0))
      expect(capped.match(/\.\.\. diff truncated:/g)).toHaveLength(1)
    })
  }

  test("bounds a single line larger than the budget", () => {
    const diff = "+" + "x".repeat(20 * 1024 * 1024)
    const capped = capDiff(diff, 128)
    expect(Buffer.byteLength(capped)).toBeLessThanOrEqual(128)
    expect(capped).toBe(`... diff truncated: ${Buffer.byteLength(diff)} bytes, 1 lines not stored\n`)
  })
})
