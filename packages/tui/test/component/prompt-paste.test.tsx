import { expect, test } from "bun:test"
import { withPrompt, type PromptRig } from "../fixture/prompt-app"

const UNDO = "\x1b[45;5u"
const ESCAPE = "\x1b"

// Where the frame shows `label`, as the cell to click inside it.
function find(rig: PromptRig, label: string) {
  const lines = rig.frame().split("\n")
  const y = lines.findIndex((line) => line.includes(label))
  if (y === -1) throw new Error(`"${label}" is not on screen:\n${rig.frame()}`)
  return { x: lines[y].indexOf(label) + 2, y }
}

async function pasteBlock(rig: PromptRig) {
  for (const char of "see ") await rig.press(char)
  await rig.press("\x1b[200~one\ntwo\nthree\x1b[201~")
  expect(rig.text()).toBe("see [Pasted ~3 lines] ")
}

async function openPlaceholder(rig: PromptRig) {
  const at = find(rig, "[Pasted ~3 lines]")
  await rig.click(at.x, at.y)
  find(rig, "Pasted text")
}

test("clicking a placeholder opens its text to edit, and escape keeps the edit", async () => {
  await withPrompt(async (rig) => {
    await pasteBlock(rig)
    await openPlaceholder(rig)
    for (const char of "zero") await rig.press(char)
    await rig.press("\r") // a new line in the editor, not a submit
    await rig.press(ESCAPE)
    expect(rig.frame()).not.toContain("Pasted text")
    expect(rig.text()).toBe("see [Pasted ~4 lines] ")
    expect(rig.parts()).toMatchObject([{ type: "text", text: "zero\none\ntwo\nthree" }])
    await rig.press(UNDO)
    expect(rig.text()).toBe("see [Pasted ~3 lines] ")
    expect(rig.parts()).toMatchObject([{ type: "text", text: "one\ntwo\nthree" }])
  })
})

test("an edit that keeps the line count keeps the label and changes the text", async () => {
  await withPrompt(async (rig) => {
    await pasteBlock(rig)
    await openPlaceholder(rig)
    await rig.press("X")
    await rig.press(ESCAPE)
    expect(rig.text()).toBe("see [Pasted ~3 lines] ")
    expect(rig.parts()).toMatchObject([{ type: "text", text: "Xone\ntwo\nthree" }])
  })
})

test("Inline replaces the placeholder with its text, and undo puts the placeholder back", async () => {
  await withPrompt(async (rig) => {
    await pasteBlock(rig)
    await openPlaceholder(rig)
    const button = find(rig, "Inline")
    await rig.click(button.x, button.y)
    expect(rig.frame()).not.toContain("Pasted text")
    expect(rig.text()).toBe("see one\ntwo\nthree ")
    expect(rig.parts()).toHaveLength(0)
    await rig.press(UNDO)
    expect(rig.text()).toBe("see [Pasted ~3 lines] ")
    expect(rig.parts()).toHaveLength(1)
  })
})

test("closing without an edit leaves the placeholder as it was", async () => {
  await withPrompt(async (rig) => {
    await pasteBlock(rig)
    await openPlaceholder(rig)
    await rig.press(ESCAPE)
    expect(rig.text()).toBe("see [Pasted ~3 lines] ")
    expect(rig.parts()).toMatchObject([{ type: "text", text: "one\ntwo\nthree" }])
  })
})
