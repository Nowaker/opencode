import { MacOSScrollAccel, type CliRenderer, type ScrollAcceleration, type ScrollBoxRenderable } from "@opentui/core"

export type ScrollConfig = {
  scroll_acceleration?: { enabled?: boolean }
  scroll_speed?: number
}

export class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private speed: number) {}

  tick(_now?: number): number {
    return this.speed
  }

  reset(): void {}
}

export function getScrollAcceleration(tuiConfig?: ScrollConfig): ScrollAcceleration {
  if (tuiConfig?.scroll_acceleration?.enabled) {
    return new MacOSScrollAccel()
  }
  if (tuiConfig?.scroll_speed !== undefined) {
    return new CustomSpeedScroll(tuiConfig.scroll_speed)
  }

  return new CustomSpeedScroll(3)
}

// Keeps a scrolled-up reader's place when content above the viewport changes
// height, e.g. when the session transcript drops its oldest message. Sticky
// scroll only follows the bottom, so without this the text slides under a fixed
// scrollTop until it reaches the bottom and starts following again. The root
// emits "layout-changed" after computing the new layout but before any
// renderable reads it, so the first child that was visible is moved back to
// where it was before anything is drawn.
export function keepScrollAnchor(renderer: CliRenderer, scroll: ScrollBoxRenderable) {
  const keep = () => {
    if (scroll.isDestroyed) return renderer.root.off("layout-changed", keep)
    if (scroll.scrollTop >= scroll.scrollHeight - scroll.viewport.height) return
    const anchor = scroll.getChildren().find((child) => child.y - scroll.content.y + child.height > scroll.scrollTop)
    if (!anchor) return
    scroll.scrollBy(anchor.getLayoutNode().getComputedLayout().top - (anchor.y - scroll.content.y))
  }
  renderer.root.on("layout-changed", keep)
}
