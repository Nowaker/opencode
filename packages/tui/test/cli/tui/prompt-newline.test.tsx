/** @jsxImportSource @opentui/solid */
import type { TextareaRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup } from "solid-js"
import "../../../src/component/prompt/textarea"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../../src/keymap"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

async function mount() {
  let prompt: TextareaRenderable | undefined
  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    onCleanup(registerOpencodeKeymap(keymap, renderer, createTuiResolvedConfig()))
    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <prompt_textarea ref={(editor) => (prompt = editor)} width={60} height={6} />
      </OpencodeKeymapProvider>
    )
  }
  const app = await testRender(() => <Harness />, { width: 80, height: 10, kittyKeyboard: true })
  await app.renderOnce()
  if (!prompt) throw new Error("the prompt must mount")
  return { app, prompt }
}

test("Shift+Enter in the prompt continues Markdown lists and closes code fences", async () => {
  const { app, prompt } = await mount()
  try {
    // `|` marks the caret before and after one Shift+Enter.
    const enter = async (marked: string) => {
      const caret = marked.indexOf("|")
      prompt.focus()
      prompt.setText(marked.replace("|", ""))
      // cursorOffset counts display cells, so a caret after wide text is placed at the buffer's end.
      if (caret === marked.length - 1) prompt.gotoBufferEnd()
      else prompt.cursorOffset = caret
      await app.renderOnce()
      app.renderer.stdin.emit("data", Buffer.from("\x1b[13;2u"))
      await app.renderOnce()
      const text = prompt.plainText
      const before = prompt.getTextRange(0, prompt.cursorOffset)
      return before + "|" + text.slice(before.length)
    }

    expect(await enter("1. first|")).toBe("1. first\n2. |")
    expect(await enter("- [x] done|")).toBe("- [x] done\n- [ ] |")
    expect(await enter("1. ab|cd")).toBe("1. ab\n2. |cd")
    expect(await enter("1. one\n2. |")).toBe("1. one\n|")
    expect(await enter("a\n- |\nb")).toBe("a\n|\nb")
    expect(await enter("- |\nnext")).toBe("|\nnext")
    expect(await enter("```ts|")).toBe("```ts\n|\n```")
    expect(await enter("```|\ncode\n```")).toBe("```\n|\ncode\n```")
    expect(await enter("plain 日本|")).toBe("plain 日本\n|")
    expect(await enter("- 日本|")).toBe("- 日本\n- |")
  } finally {
    app.renderer.destroy()
  }
})
