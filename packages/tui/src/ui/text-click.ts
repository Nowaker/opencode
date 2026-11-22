import { MouseButton, TextBufferRenderable, getLinkId, resolveRenderLib } from "@opentui/core"
import type { CliRenderer, MouseEvent } from "@opentui/core"
import type { TuiTextClickHandler } from "@opencode-ai/plugin/tui"
import { cellText } from "./id-click"

export function transcriptClick(input: {
  renderer: CliRenderer
  sessionID: string
  enabled: () => boolean
  run: TuiTextClickHandler
}) {
  let press: { x: number; y: number; target: MouseEvent["target"] } | undefined
  return {
    onMouseDown(event: MouseEvent) {
      press = event.button === MouseButton.LEFT ? { x: event.x, y: event.y, target: event.target } : undefined
    },
    onMouseDrag() {
      press = undefined
    },
    onMouseUp(event: MouseEvent) {
      const start = press
      press = undefined
      if (event.button !== MouseButton.LEFT || start?.x !== event.x || start.y !== event.y) return false
      if (event.modifiers.alt || event.modifiers.ctrl || event.modifiers.shift || event.defaultPrevented) return false
      if (!input.enabled() || input.renderer.getSelection()?.getSelectedText()) return false
      const target = event.target
      if (!target || target !== start.target) return false
      const cells = input.renderer.currentRenderBuffer
      const left = Math.max(0, target.x)
      const right = Math.min(cells.width, target.x + target.width)
      if (event.x < left || event.x >= right || event.y < 0 || event.y >= cells.height) return false
      const line = logicalText(target, event)
      const link = getLinkId(cells.buffers.attributes[event.y * cells.width + event.x])
      // OpenTUI 0.4 has no renderer-level href lookup. Its link pool is exposed by the Bun renderer but not typed.
      const renderLib = link ? resolveRenderLib() : undefined
      const url =
        renderLib && "linkGetUrl" in renderLib && typeof renderLib.linkGetUrl === "function"
          ? renderLib.linkGetUrl(link, 8192)
          : undefined
      const text = line?.text ?? cellText(cells, event.y, left, right)
      const column = line?.column ?? event.x - left
      const href = typeof url === "string" && url ? url : undefined
      if (input.run({ text, column, href, sessionID: input.sessionID }) !== true) return false
      event.preventDefault()
      event.stopPropagation()
      return true
    },
  }
}

function logicalText(target: MouseEvent["target"], event: MouseEvent) {
  if (!(target instanceof TextBufferRenderable)) return
  const row = event.y - target.y + target.scrollY
  const info = target.lineInfo
  const source = info.lineSources[row]
  const start = info.lineStartCols[row - info.lineWraps[row]]
  const offset = info.lineStartCols[row]
  const cell = event.x - target.x + target.scrollX
  if (source === undefined || start === undefined || offset === undefined || cell >= info.lineWidthCols[row]) return
  const text = target.plainText.split("\n")[source]
  if (text === undefined) return
  return { text, column: offset - start + cell }
}
