type Point = { x: number; y: number }

// A section header is also the handle that drags a section and the place another section
// is dropped on, so it toggles only when it is pressed and released on the same cell.
export function onHeaderClick(run: () => void) {
  let press: Point | undefined
  return {
    onMouseDown: (event: Point) => {
      press = { x: event.x, y: event.y }
    },
    onMouseUp: (event: Point) => {
      const click = press?.x === event.x && press.y === event.y
      press = undefined
      if (click) run()
    },
  }
}
