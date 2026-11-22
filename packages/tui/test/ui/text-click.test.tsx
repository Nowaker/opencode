/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { TuiTextClickEvent } from "@opencode-ai/plugin/tui"
import { testRender, useRenderer } from "@opentui/solid"
import { transcriptClick } from "../../src/ui/text-click"

const uri = "ile:///Users/nowaker/Downloads/t13-nextcloud-mac-restore.md"
const plain = `界 ${uri}`

test("a plain click in a wrapped transcript link claims the complete path before the row action", async () => {
  const clicked: TuiTextClickEvent[] = []
  let fallback = 0
  function Transcript() {
    const click = transcriptClick({
      renderer: useRenderer(),
      sessionID: "fixture-session",
      enabled: () => true,
      run: (event) => {
        if (!event.text.includes(uri) && event.href !== uri) return false
        clicked.push(event)
        return true
      },
    })
    return (
      <scrollbox {...click}>
        <box
          onMouseUp={(event) => {
            if (!click.onMouseUp(event)) fallback++
          }}
        >
          <text>{plain}</text>
          <text>
            <a href={uri}>Report link</a>
          </text>
          <text>Ordinary text</text>
        </box>
      </scrollbox>
    )
  }
  const app = await testRender(() => <Transcript />, { width: 34, height: 8 })
  try {
    app.renderer.pause()
    await app.renderOnce()
    const hit = async (needle: string, offset = 0) => {
      await app.renderOnce()
      const rows = app.captureCharFrame().split("\n")
      const y = rows.findIndex((row) => row.includes(needle))
      expect(y).toBeGreaterThanOrEqual(0)
      return { x: rows[y].indexOf(needle) + offset, y }
    }
    const tail = await hit("restore.md")
    await app.mockMouse.click(tail.x, tail.y, undefined, { delayMs: 0 })
    const label = await hit("Report link", 2)
    await app.mockMouse.click(label.x, label.y, undefined, { delayMs: 0 })
    expect(clicked).toEqual([
      { text: plain, column: Bun.stringWidth(plain.slice(0, plain.indexOf("restore"))), sessionID: "fixture-session" },
      { text: "Report link", column: 2, href: uri, sessionID: "fixture-session" },
    ])
    expect(fallback).toBe(0)
    const ordinary = await hit("Ordinary text", 3)
    await app.mockMouse.click(ordinary.x, ordinary.y, undefined, { delayMs: 0 })
    expect(fallback).toBe(1)
    await app.mockMouse.drag(0, tail.y, 8, tail.y, undefined, { delayMs: 0 })
    await app.mockMouse.click(label.x, label.y, 0, { modifiers: { shift: true }, delayMs: 0 })
    expect(clicked).toHaveLength(2)
  } finally {
    app.renderer.destroy()
  }
})

test("a custom renderable's visible row is not marked as a complete logical line", async () => {
  const clicked: TuiTextClickEvent[] = []
  function Transcript() {
    const click = transcriptClick({
      renderer: useRenderer(),
      sessionID: "fixture-session",
      enabled: () => true,
      run: (event) => clicked.push(event) > 0,
    })
    return <box {...click} border title="界 café 👩‍💻 fragment" width={26} height={3} />
  }
  const app = await testRender(() => <Transcript />, { width: 30, height: 5 })
  try {
    await app.renderOnce()
    const row = app.captureCharFrame().split("\n")[0]
    expect(row).toContain("界 café 👩‍💻 fragment")
    const column = Bun.stringWidth(row.slice(0, row.indexOf("fragment")))
    await app.mockMouse.pressDown(column, 0, undefined, { modifiers: { shift: true }, delayMs: 0 })
    await app.mockMouse.release(column, 0, undefined, { delayMs: 0 })
    expect(clicked).toHaveLength(0)
    await app.mockMouse.click(column, 0, undefined, { delayMs: 0 })
    expect(clicked).toHaveLength(1)
    expect(clicked[0]).toMatchObject({ rowOnly: true, column, text: expect.stringContaining("界 café 👩‍💻 fragment") })
  } finally {
    app.renderer.destroy()
  }
})
