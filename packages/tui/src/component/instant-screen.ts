import { BoxRenderable, MouseButton, RGBA, TextAttributes, type CliRenderer, type MouseEvent } from "@opentui/core"
import type { TuiConfig } from "../config"
import { InstantPrompt } from "../instant"
import type { InstantFrame } from "../instant/frame"

const DEFAULT_FG = RGBA.fromInts(255, 255, 255)
const TRANSPARENT = RGBA.fromInts(0, 0, 0, 0)

const sameColor = (a: InstantFrame.Rgb | undefined, b: InstantFrame.Rgb | undefined) =>
  a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2])

function sameStyle(a: InstantFrame.Cell, b: InstantFrame.Cell) {
  return !!a.bold === !!b.bold && !!a.inverse === !!b.inverse && sameColor(a.fg, b.fg) && sameColor(a.bg, b.bg)
}

function color(value: InstantFrame.Rgb | undefined, fallback: RGBA) {
  return value ? RGBA.fromInts(value[0], value[1], value[2]) : fallback
}

// Draws the instant startup prompt's frame from the renderer's first frame
// until the home prompt takes over. It sits on the renderer root rather than
// in the component tree because the tree renders nothing until the SDK, sync
// and theme providers have loaded, which would leave the screen blank.
export function mountInstantScreen(renderer: CliRenderer, cursor: TuiConfig.Resolved["cursor"]) {
  const pointer = (action: "press" | "drag" | "release") => (event: MouseEvent) => {
    if (event.button !== MouseButton.LEFT) return
    InstantPrompt.mouse({ type: "mouse", button: 0, x: event.x, y: event.y, action })
  }
  const box = new BoxRenderable(renderer, {
    id: "instant-screen",
    position: "absolute",
    left: 0,
    top: 0,
    width: "100%",
    height: "100%",
    zIndex: 10000,
    renderAfter(buffer) {
      const frame = InstantPrompt.frame(renderer.width, renderer.height)
      if (!frame) return
      // One drawText per run of equally styled cells, not per cell.
      frame.grid.forEach((row, y) => {
        let start = 0
        let run = ""
        let style: InstantFrame.Cell | undefined
        const flush = () => {
          if (!style || !run) return
          const attributes = (style.bold ? TextAttributes.BOLD : 0) | (style.inverse ? TextAttributes.INVERSE : 0)
          buffer.drawText(run, start, y, color(style.fg, DEFAULT_FG), color(style.bg, TRANSPARENT), attributes)
        }
        row.forEach((cell, x) => {
          if (cell.ch === "") return
          if (!style || !sameStyle(style, cell)) {
            flush()
            start = x
            run = ""
            style = cell
          }
          run += cell.ch
        })
        flush()
      })
      renderer.setCursorPosition(frame.cursor.x + 1, frame.cursor.y + 1, true)
    },
    onMouseDown: pointer("press"),
    onMouseDrag: pointer("drag"),
    onMouseUp: pointer("release"),
  })
  renderer.root.add(box)
  renderer.requestRender()
  if (cursor?.style !== "default") {
    const text = InstantPrompt.textColor()
    renderer.setCursorStyle({
      style: cursor?.style ?? "block",
      blinking: cursor?.blinking ?? true,
      color: text ? RGBA.fromHex(text.slice(0, 7)) : DEFAULT_FG,
    })
  }
  return () => {
    renderer.root.remove(box)
    box.destroy()
    renderer.requestRender()
  }
}
