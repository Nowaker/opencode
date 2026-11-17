import assert from "node:assert/strict"
import { expect } from "bun:test"
import { TextareaRenderable, type KeyEvent, type Renderable } from "@opentui/core"
import { onMount } from "solid-js"
import type { mountComposer } from "./composer"

export type ComposerFixture = Awaited<ReturnType<typeof mountComposer>>

export async function selectBeforeLayout(setup: ComposerFixture) {
  await setup.renderOnce()
  setup.renderer.pause()
  const mounted = Promise.withResolvers<void>()
  setup.context.ui.slot({
    append: "session.composer.top",
    render: () => {
      onMount(mounted.resolve)
      return null
    },
  })
  setup.context.ui.router.navigate({ type: "session", sessionID: "ses_observation_a" })
  await mounted.promise
  const inputs = textareas(setup.renderer.root)
  expect(inputs).toHaveLength(1)
  const input = inputs[0]
  assert.ok(input)
  expect({ width: input.width, height: input.height }).toEqual({ width: 0, height: 0 })
  return input
}

function textareas(node: Renderable): TextareaRenderable[] {
  return [...(node instanceof TextareaRenderable ? [node] : []), ...node.getChildren().flatMap(textareas)]
}

export function shiftedKeys(setup: ComposerFixture) {
  const done = Promise.withResolvers<void>()
  let count = 0
  const listener = (event: KeyEvent) => {
    if (event.name === "left" && event.shift && ++count === 2) queueMicrotask(done.resolve)
  }
  setup.renderer.keyInput.prependListener("keypress", listener)
  return { done: done.promise, [Symbol.dispose]: () => setup.renderer.keyInput.off("keypress", listener) }
}
