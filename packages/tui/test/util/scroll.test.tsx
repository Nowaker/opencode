/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { ScrollBoxRenderable } from "@opentui/core"
import { testRender, useRenderer } from "@opentui/solid"
import { createSignal, For } from "solid-js"
import { keepScrollAnchor } from "../../src/util/scroll"

async function mount() {
  const [items, setItems] = createSignal(Array.from({ length: 40 }, (_, i) => i))
  let scroll!: ScrollBoxRenderable
  const app = await testRender(
    () => {
      const renderer = useRenderer()
      return (
        <scrollbox
          ref={(r: ScrollBoxRenderable) => {
            scroll = r
            keepScrollAnchor(renderer, r)
          }}
          stickyScroll={true}
          stickyStart="bottom"
          flexGrow={1}
        >
          <For each={items()}>
            {(item) => (
              <box flexShrink={0} height={2}>
                <text>{`item ${item}`}</text>
              </box>
            )}
          </For>
        </scrollbox>
      )
    },
    { width: 30, height: 10 },
  )
  await app.renderOnce()
  // Drop the oldest item and append a new one, as the session transcript does.
  const rotate = async () => {
    setItems((list) => [...list.slice(1), list[list.length - 1]! + 1])
    await app.renderOnce()
  }
  const firstLine = () => app.captureCharFrame().trim().split("\n")[0]!.trim()
  return { app, scroll: () => scroll, rotate, firstLine }
}

test("keeps the reader's place when items above the viewport are dropped", async () => {
  const view = await mount()
  view.scroll().scrollBy(-20)
  await view.app.renderOnce()
  const before = view.firstLine()

  await view.rotate()
  await view.rotate()
  await view.rotate()

  expect(view.firstLine()).toBe(before)
  view.app.renderer.destroy()
})

test("keeps following new items at the bottom", async () => {
  const view = await mount()
  expect(view.app.captureCharFrame()).toContain("item 39")

  await view.rotate()
  await view.rotate()

  expect(view.app.captureCharFrame()).toContain("item 41")
  view.app.renderer.destroy()
})
