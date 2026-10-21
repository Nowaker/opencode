import { describe, expect, test } from "bun:test"
import { cellText, createIdClick, idAt, idUnder, markOwnIds } from "../../src/ui/id-click"

const SES = "ses_ee68a7aceffeiGmNH03eS7PU61"
const MSG = "msg_119742d10001srfC3wz8krD00i"

// A frame as the renderer holds it: one code point per cell, rows padded to the width.
function frame(...rows: string[]) {
  const width = Math.max(...rows.map((row) => row.length))
  const char = new Uint32Array(width * rows.length)
  rows.forEach((row, y) => [...row.padEnd(width)].forEach((ch, x) => (char[y * width + x] = ch.codePointAt(0)!)))
  return { width, height: rows.length, buffers: { char } }
}

const area = (x: number, y: number, width: number, height: number) => ({ x, y, width, height, parent: null })

describe("ui.id-click", () => {
  test("finds a session or message ID under any of its cells", () => {
    const cells = frame(`see \`${SES}\` and ${MSG}.`)
    const ses = 5
    const msg = `see \`${SES}\` and `.length
    expect(idAt(cells, ses, 0)).toEqual({ kind: "session", value: SES })
    expect(idAt(cells, ses + SES.length - 1, 0)).toEqual({ kind: "session", value: SES })
    expect(idAt(cells, msg + 10, 0)).toEqual({ kind: "message", value: MSG })
    expect(idAt(cells, 1, 0)).toBeUndefined()
    expect(idAt(cells, ses - 1, 0)).toBeUndefined()
  })

  test("ignores words that only look like IDs", () => {
    const cells = frame("ses_short tool_ses_ee68a7aceffeiGmNH03eS7PU61 session_id")
    expect(idAt(cells, 2, 0)).toBeUndefined()
    expect(idAt(cells, 20, 0)).toBeUndefined()
    expect(idAt(cells, 50, 0)).toBeUndefined()
  })

  test("finds any other prefixed ID with the text before it on its row, but not a snake_case word", () => {
    const part = "prt_13b3002ef001ioi4WZ80sx8d6t"
    const cells = frame(`part ${part} tool_name`)
    expect(idAt(cells, 6, 0)).toEqual({ kind: "id", value: part, before: "part " })
    expect(idAt(cells, part.length + 8, 0)).toBeUndefined()
  })

  test("finds a provider call ID only after a label naming it", () => {
    const call = "toolu_01AbCdEfGhIjKl"
    expect(idAt(frame(`callID: "${call}"`), 10, 0)).toEqual({ kind: "id", value: call, before: 'callID: "' })
    expect(idAt(frame(`see ${call}`), 6, 0)).toBeUndefined()
  })

  test("finds a commit hash of 7 to 40 hex, but not a number, a hex word or a longer run", () => {
    const sha = "f1e1275"
    const full = "f1e12758b04c6e3a0d9bb2e0c0e5a9e4f3a2b1c0"
    expect(idAt(frame(`fixed in ${sha}.`), 10, 0)).toEqual({ kind: "commit", value: sha })
    expect(idAt(frame(full), 20, 0)).toEqual({ kind: "commit", value: full })
    expect(idAt(frame("2026101 defaced f1e127"), 2, 0)).toBeUndefined()
    expect(idAt(frame("2026101 defaced f1e127"), 10, 0)).toBeUndefined()
    expect(idAt(frame("2026101 defaced f1e127"), 18, 0)).toBeUndefined()
    expect(idAt(frame(`${full}a`), 3, 0)).toBeUndefined()
  })

  test("reads only inside the clicked renderable, so a neighbouring column does not join the ID", () => {
    const cells = frame(`${SES}abc`)
    expect(idAt(cells, 3, 0)?.value).toBe(`${SES}abc`)
    expect(idAt(cells, 3, 0, area(0, 0, SES.length, 1))).toEqual({ kind: "session", value: SES })
    expect(idAt(cells, SES.length + 1, 0, area(0, 0, SES.length, 1))).toBeUndefined()
  })

  test("an ID drawn by a marked renderable or its children is the session's own", () => {
    const cells = frame(SES)
    const footer = area(0, 0, SES.length, 1)
    const span = { ...area(0, 0, SES.length, 1), parent: footer }
    expect(idUnder(cells, { x: 2, y: 0, target: span })?.own).toBe(false)
    markOwnIds(footer)
    expect(idUnder(cells, { x: 2, y: 0, target: span })).toEqual({ kind: "session", value: SES, own: true })
    expect(idUnder(cells, { x: 2, y: 0, target: null })).toBeUndefined()
  })

  test("a row reads one character per cell", () => {
    const cells = frame("▣  Build · QA Model")
    expect(cellText(cells, 0, 0, 20)).toBe("▣  Build · QA Model")
    expect(cellText(cells, 0, 3, 8)).toBe("Build")
    expect(cellText(cells, 1, 0, 5)).toBe("")
  })

  test("handlers run newest first until one takes the click", () => {
    const ids = createIdClick()
    const seen: string[] = []
    const event = { target: { kind: "message" as const, value: MSG }, context: { sessionID: SES } }
    ids.on(() => void seen.push("first"))
    const off = ids.on(() => {
      seen.push("second")
      return true
    })
    expect(ids.run(event)).toBe(true)
    expect(seen).toEqual(["second"])
    off()
    expect(ids.run(event)).toBe(false)
    expect(seen).toEqual(["second", "first"])
  })
})
