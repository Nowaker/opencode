import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { StartupLayer } from "../../src/startup/layer"

test.each([
  { action: "type", expected: "abcZ" },
  { action: "paste", expected: "abcZ" },
  { action: "extend", expected: "abZ" },
  { action: "burst", expected: "abcQZ" },
] as const)("startup selection survives an underlying cursor write before $action", async (input) => {
  await using setup = await fixture()
  setup.underlying.cursorOffset = 1
  switch (input.action) {
    case "type":
      await setup.mockInput.typeText("Z")
      break
    case "paste":
      await setup.mockInput.pasteBracketedText("Z")
      break
    case "extend":
      await setup.mockInput.pressArrow("left", { shift: true })
      await setup.mockInput.typeText("Z")
      break
    case "burst":
      setup.renderer.stdin.emit("data", Buffer.from("Z\x1b[DQ"))
      break
    default: {
      const unreachable: never = input
      throw new Error(`Unexpected edit action ${unreachable}`)
    }
  }
  await setup.renderOnce()
  expect(setup.layer.textarea.plainText).toBe(input.expected)
  expect(setup.layer.read().text).toBe(input.expected)
})

test.each([
  { action: "click", expected: "abcZdef" },
  { action: "drag", expected: "abZ" },
  { action: "extend", expected: "abZ" },
] as const)("startup mouse $action updates the selection used by the next key", async (input) => {
  await using setup = await fixture()
  const x = Math.trunc(setup.layer.textarea.x)
  const y = Math.trunc(setup.layer.textarea.y)
  switch (input.action) {
    case "click":
      await setup.mockMouse.click(x + 3, y, undefined, { delayMs: 0 })
      break
    case "drag":
      await setup.mockMouse.drag(x + 6, y, x + 3, y, undefined, { delayMs: 0 })
      await setup.mockInput.pressArrow("left", { shift: true })
      break
    case "extend":
      setup.underlying.cursorOffset = 1
      await setup.mockMouse.click(x + 2, y, undefined, { modifiers: { ctrl: true }, delayMs: 0 })
      break
    default: {
      const unreachable: never = input
      throw new Error(`Unexpected mouse action ${unreachable}`)
    }
  }
  await setup.mockInput.typeText("Z")
  await setup.renderOnce()
  expect(setup.layer.textarea.plainText).toBe(input.expected)
})

test.each(["key", "paste"] as const)("releasing startup input preserves subsequent %s handlers", async (kind) => {
  await using setup = await fixture()
  const keys = setup.renderer.keyInput
  switch (kind) {
    case "key": {
      const dispatch = keys.processParsedKey
      keys.processParsedKey = (event) => {
        const result = dispatch.call(keys, event)
        setup.underlying.insertText("P")
        return result
      }
      break
    }
    case "paste": {
      const dispatch = keys.processPaste
      keys.processPaste = (bytes, metadata) => {
        dispatch.call(keys, bytes, metadata)
        setup.underlying.insertText("P")
      }
      break
    }
    default: {
      const unreachable: never = kind
      throw new Error(`Unexpected dispatch kind ${unreachable}`)
    }
  }
  setup.layer.destroy()
  setup.underlying.clear()
  setup.underlying.focus()
  await {
    key: () => setup.mockInput.typeText("Z"),
    paste: () => setup.mockInput.pasteBracketedText("Z"),
  }[kind]()
  await setup.renderOnce()
  expect(setup.underlying.plainText).toBe("ZP")
})

async function fixture() {
  const setup = await createTestRenderer({ width: 80, height: 24, kittyKeyboard: true, useMouse: true })
  await setup.renderer.setupTerminal()
  const layer = StartupLayer.create(setup.renderer, "home", {
    text: "abcdef",
    caret: 3,
    anchor: 6,
    touched: true,
    submit: false,
  })
  const underlying = new TextareaRenderable(setup.renderer, { id: "underlying", width: 20, height: 1 })
  setup.renderer.root.add(underlying)
  underlying.setText("another composer")
  const restored = StartupLayer.restore(setup.renderer, layer.textarea, layer.draft)
  await setup.renderOnce()
  await restored
  return {
    ...setup,
    layer,
    underlying,
    async [Symbol.asyncDispose]() {
      layer.destroy()
      await setup.dispose()
    },
  }
}
