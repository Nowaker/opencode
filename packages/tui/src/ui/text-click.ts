import { MouseButton, TextBufferRenderable } from "@opentui/core"
import type { CliRenderer, MouseEvent } from "@opentui/core"
import type { TextClickEvent, TextClickHandler } from "@opencode/plugin/tui/context"

export function textClickHandlers(onError: (error: unknown) => void) {
  const handlers: TextClickHandler[] = []
  return {
    get active() {
      return handlers.length > 0
    },
    on(handler: TextClickHandler) {
      const registration: TextClickHandler = (event) => handler(event)
      handlers.push(registration)
      return () => {
        const index = handlers.indexOf(registration)
        if (index >= 0) handlers.splice(index, 1)
      }
    },
    run(event: TextClickEvent) {
      return handlers.toReversed().some((handler) => {
        try {
          return handler(event) === true
        } catch (error) {
          onError(error)
          return false
        }
      })
    },
  }
}

export function transcriptClick(input: {
  renderer: CliRenderer
  sessionID: string
  enabled: () => boolean
  run: TextClickHandler
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
      if (!input.enabled()) return false
      const selection = input.renderer.getSelection()
      if (selection && (!selection.isStart || selection.behavior !== "cell")) return false
      const target = event.target
      if (!target || target !== start.target) return false
      const cells = input.renderer.currentRenderBuffer
      const left = Math.max(0, target.x)
      const right = Math.min(cells.width, target.x + target.width)
      if (event.x < left || event.x >= right || event.y < 0 || event.y >= cells.height) return false
      const line = logicalText(target, event)
      const text =
        line?.text ??
        cells.withBuffers(({ char, width }) => {
          const offset = event.y * width
          return Array.from(char.subarray(offset + left, offset + right), (code) =>
            code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd",
          ).join("")
        })
      const column = line?.column ?? event.x - left
      const href = input.renderer.getLinkAt(event.x, event.y) ?? undefined
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
