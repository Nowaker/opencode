import { expect, setDefaultTimeout, test } from "bun:test"
import { wait, withPrompt, type PromptRig } from "../fixture/prompt-app"

// The first test in the file also pays for starting the whole app.
setDefaultTimeout(30_000)

const UNDO = "\x1b[45;5u"
const ESCAPE = "\x1b"
const ENTER = "\r"
const SPACE = " "
const DOWN = "\x1b[B"
const UP = "\x1b[A"
const TAB = "\t"
const config = { prompt: { paste_mode: "dialog" as const } }
const code = "    def f():\n        return 1\n"

function find(rig: PromptRig, label: string) {
  const lines = rig.frame().split("\n")
  const y = lines.findIndex((line) => line.includes(label))
  if (y === -1) throw new Error(`"${label}" is not on screen:\n${rig.frame()}`)
  return { x: lines[y].indexOf(label) + 2, y }
}

async function paste(rig: PromptRig, text: string) {
  await rig.press(`\x1b[200~${text}\x1b[201~`)
  await wait(() => rig.frame().includes("enter paste"))
}

async function closed(rig: PromptRig) {
  await wait(() => !rig.frame().includes("enter paste"))
}

// What the prompt sends, which is its text with each placeholder's text in its place.
async function submitted(rig: PromptRig) {
  await rig.press(ENTER)
  await wait(() => rig.sent.length > 0)
  return JSON.parse(rig.sent[0]).parts.find((part: { type: string }) => part.type === "text").text
}

// The option rows are, in order: insert inline, ```, `, >, trim, normalize indents, collapse, ANSI.
async function select(rig: PromptRig, index: number) {
  for (let step = 0; step < index; step++) await rig.press(DOWN)
}

test("a paste opens the dialog, and its preview follows the options", async () => {
  await withPrompt(
    async (rig) => {
      await paste(rig, code)
      expect(rig.text()).toBe("")
      expect(rig.frame()).toContain("[ ] insert inline")
      expect(rig.frame()).toMatch(/┃\s+ {4}def f\(\):/)
      await select(rig, 5)
      await rig.press(SPACE)
      expect(rig.frame()).toContain("[x] normalize indents")
      expect(rig.frame()).toMatch(/┃\s{2}def f\(\):/)
      await select(rig, 4) // down four more wraps round to ```
      await rig.press(SPACE)
      expect(rig.frame()).toContain("[x] wrap with ```")
      expect(rig.frame()).toMatch(/┃\s{2}```/)
      await rig.press(ENTER)
      await closed(rig)
      // Without trim the copied line's newline stays, as a blank line before the closing fence.
      expect(rig.text()).toBe("[Pasted ~5 lines] ")
      expect(await submitted(rig)).toBe("```\ndef f():\n    return 1\n\n``` ")
    },
    { config },
  )
})

test("inline code is greyed out and cannot be turned on for more than one line", async () => {
  await withPrompt(
    async (rig) => {
      await paste(rig, "a\nb")
      await select(rig, 2)
      await rig.press(SPACE)
      expect(rig.frame()).toContain("[ ] wrap with `")
      await rig.press(ENTER)
      await closed(rig)
      expect(await submitted(rig)).toBe("a\nb ")
    },
    { config },
  )
})

test("insert inline puts the text in the prompt, and the choice is kept for the next paste", async () => {
  await withPrompt(
    async (rig) => {
      await paste(rig, "one\ntwo")
      await rig.press(SPACE)
      await rig.press(ENTER)
      await closed(rig)
      expect(rig.text()).toBe("one\ntwo")
      await paste(rig, "three")
      expect(rig.frame()).toContain("[x] insert inline")
      await rig.press(ESCAPE)
      await closed(rig)
      expect(rig.text()).toBe("one\ntwo")
    },
    { config },
  )
})

test("the options last chosen are read back from kv", async () => {
  await withPrompt(
    async (rig) => {
      await paste(rig, "x")
      expect(rig.frame()).toContain("[x] quote with >")
      expect(rig.frame()).toMatch(/┃\s+> x/)
    },
    { config, kv: { paste_options: { quote: true } } },
  )
})

test("undo right after a paste takes it back and reopens the dialog with it", async () => {
  await withPrompt(
    async (rig) => {
      for (const char of "see") await rig.press(char)
      await paste(rig, "a\nb\nc")
      await rig.press(ENTER)
      await closed(rig)
      expect(rig.text()).toBe("see[Pasted ~3 lines] ")
      await rig.press(UNDO)
      await wait(() => rig.frame().includes("enter paste"))
      await rig.press(SPACE)
      await rig.press(ENTER)
      await closed(rig)
      expect(rig.text()).toBe("seea\nb\nc")
    },
    { config },
  )
})

test("a click on a placeholder reopens it with its options, and esc leaves it as it was", async () => {
  await withPrompt(
    async (rig) => {
      await paste(rig, "a\nb\nc")
      await select(rig, 3)
      await rig.press(SPACE)
      await rig.press(ENTER)
      await closed(rig)
      expect(rig.parts()).toBe(1)
      const at = find(rig, "[Pasted ~3 lines]")
      await rig.click(at.x, at.y)
      await wait(() => rig.frame().includes("enter paste"))
      expect(rig.frame()).toContain("[x] quote with >")
      await rig.press(SPACE) // the selection starts on insert inline
      await rig.press(ENTER)
      await closed(rig)
      expect(rig.text()).toBe("> a\n> b\n> c ")
      await rig.press(UNDO)
      const again = find(rig, "[Pasted ~3 lines]")
      await rig.click(again.x, again.y)
      await wait(() => rig.frame().includes("enter paste"))
      await rig.press(ESCAPE)
      await closed(rig)
      expect(await submitted(rig)).toBe("> a\n> b\n> c ")
    },
    { config },
  )
})

test("tab moves to the editor, where space and letters type and enter still pastes", async () => {
  await withPrompt(
    async (rig) => {
      await paste(rig, "a\nb\nc")
      await rig.press(TAB)
      for (const char of "X Y") await rig.press(char)
      await rig.press(TAB)
      await rig.press(UP) // back in the options: wraps round to the last one
      await rig.press(TAB)
      await rig.press(ENTER)
      await closed(rig)
      expect(await submitted(rig)).toBe("X Ya\nb\nc ")
    },
    { config },
  )
})

test("esc on a new paste puts nothing in the prompt", async () => {
  await withPrompt(
    async (rig) => {
      await paste(rig, "a\nb\nc")
      await rig.press(ESCAPE)
      await closed(rig)
      expect(rig.text()).toBe("")
      expect(rig.parts()).toBe(0)
    },
    { config },
  )
})
