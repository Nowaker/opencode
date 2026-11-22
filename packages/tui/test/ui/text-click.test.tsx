/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { TextClickEvent } from "@opencode/plugin/tui/context"
import { testRender, useRenderer } from "@opentui/solid"
import { transcriptClick } from "../../src/ui/text-click"

const uri = "ile:///Users/nowaker/Downloads/t13-nextcloud-mac-restore.md"
const plain = `界 ${uri}`

test("a plain click in a wrapped transcript link claims the complete path before the row action", async () => {
  const clicked: TextClickEvent[] = []
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
    await app.renderOnce()
    const rows = app.captureCharFrame().split("\n")
    const tail = rows.findIndex((row) => row.includes("restore.md"))
    const label = rows.findIndex((row) => row.includes("Report link"))
    const ordinary = rows.findIndex((row) => row.includes("Ordinary text"))
    await app.mockMouse.click(rows[tail].indexOf("restore"), tail, undefined, { delayMs: 0 })
    await app.mockMouse.click(rows[label].indexOf("Report"), label, undefined, { delayMs: 0 })
    expect(clicked).toEqual([
      { text: plain, column: Bun.stringWidth(plain.slice(0, plain.indexOf("restore"))), sessionID: "fixture-session" },
      { text: "Report link", column: 0, href: uri, sessionID: "fixture-session" },
    ])
    expect(fallback).toBe(0)
    await app.mockMouse.click(rows[ordinary].indexOf("Ordinary"), ordinary, undefined, { delayMs: 0 })
    expect(fallback).toBe(1)
    await app.mockMouse.drag(0, tail, 8, tail, undefined, { delayMs: 0 })
    await app.mockMouse.click(3, label, 0, { modifiers: { shift: true }, delayMs: 0 })
    expect(clicked).toHaveLength(2)
  } finally {
    app.renderer.destroy()
  }
})
