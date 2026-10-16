import { Renderable, type BaseRenderable, type BoxRenderable } from "@opentui/core"

const previousByParent = new WeakMap<
  BaseRenderable,
  { frameID: number; previous: WeakMap<BaseRenderable, BaseRenderable | undefined> }
>()

export function setPreLayoutSiblingMargin(el: BoxRenderable, margin: (previous?: BaseRenderable) => number) {
  // Run before Yoga layout so scroll geometry matches the rendered frame.
  el.onLifecyclePass = () => {
    const parent = el.parent
    if (!parent) return
    const cached = previousByParent.get(parent)
    const previous = cached?.frameID === el.ctx.frameId ? cached.previous : previousSiblings(parent, el.ctx.frameId)
    const value = margin(previous.get(el))
    if (el.marginTop !== value) el.marginTop = value
  }
}

// A renderable hidden with `visible` takes no room, so the one before it is the last one shown.
// Solid's empty placeholders are not Renderables and still count, as they always have.
function previousSiblings(parent: BaseRenderable, frameID: number) {
  const previous = new WeakMap<BaseRenderable, BaseRenderable | undefined>()
  let last: BaseRenderable | undefined
  for (const child of parent.getChildren()) {
    previous.set(child, last)
    if (child.visible || !(child instanceof Renderable)) last = child
  }
  previousByParent.set(parent, { frameID, previous })
  return previous
}
