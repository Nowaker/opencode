import { MouseButton, TextBufferRenderable } from "@opentui/core"
import type { CliRenderer, MouseEvent } from "@opentui/core"
import type { TextClickEvent, TextClickHandler } from "@opencode/plugin/tui/context"
import { Locale } from "../util/locale"
import { stringWidth } from "../util/string-width"

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
      press = plainLeft(event) ? { x: event.x, y: event.y, target: event.target } : undefined
    },
    onMouseDrag() {
      press = undefined
    },
    onMouseUp(event: MouseEvent) {
      const start = press
      press = undefined
      if (!plainLeft(event) || start?.x !== event.x || start.y !== event.y) return false
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
      const text = line?.text ?? renderedRow(cells, event.y, { left, right })
      if (text === undefined) return false
      const column = line?.column ?? event.x - left
      const href = input.renderer.getLinkAt(event.x, event.y) ?? undefined
      if (input.run({ text, column, href, sessionID: input.sessionID, ...(line ? {} : { rowOnly: true }) }) !== true)
        return false
      event.preventDefault()
      event.stopPropagation()
      return true
    },
  }
}

function plainLeft(event: MouseEvent) {
  return (
    event.button === MouseButton.LEFT &&
    !event.modifiers.alt &&
    !event.modifiers.ctrl &&
    !event.modifiers.shift &&
    !event.defaultPrevented
  )
}

function renderedRow(cells: CliRenderer["currentRenderBuffer"], y: number, bounds: { left: number; right: number }) {
  const row = new TextDecoder("utf-8", { ignoreBOM: true }).decode(cells.getRealCharBytes(true)).split("\n")[y] ?? ""
  return cells.withBuffers(({ char, width }) => {
    const clusters = Locale.graphemes(row)[Symbol.iterator]()
    const offset = y * width
    let text = ""
    for (let x = 0; x < bounds.right; x++) {
      if (char[offset + x] >>> 30 === 3) {
        if (x === bounds.left) text += " "
        continue
      }
      const cluster = clusters.next().value
      const code = char[offset + x]
      const wide = x + 1 < width && char[offset + x + 1] >>> 30 === 3
      if (cluster === undefined || stringWidth(cluster) !== (wide ? 2 : 1)) return
      if (code <= 0x10ffff && cluster !== String.fromCodePoint(code || 32)) return
      if (x < bounds.left) continue
      text += x + 1 === bounds.right && wide ? " " : cluster
    }
    return text
  })
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
