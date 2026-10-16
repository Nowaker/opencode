/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createBindingLookup } from "@opentui/keymap/extras"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup } from "solid-js"
import type { InputRenderable, TextareaRenderable } from "@opentui/core"
import { TuiKeybind } from "../src/config/keybind"
import { getOpencodeModeStack, OPENCODE_BASE_MODE, OpencodeKeymapProvider, registerOpencodeKeymap } from "../src/keymap"
import type { LineDiscard } from "../src/util/line-discard"

function createResolvedKeymapConfig(input: TuiKeybind.KeybindOverrides = {}) {
  const keybinds = TuiKeybind.parse(input)
  return {
    keybinds: createBindingLookup(TuiKeybind.toBindingConfig(keybinds), {
      commandMap: TuiKeybind.CommandMap,
      bindingDefaults: TuiKeybind.bindingDefaults(),
    }),
    leader_timeout: 2000,
  }
}

test("legacy page key aliases compile as page keys", async () => {
  const sequences: Record<string, string[][]> = {}

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createResolvedKeymapConfig({
      messages_page_up: "pgup",
      messages_page_down: "pgdown",
    })
    const offKeymap = registerOpencodeKeymap(keymap, renderer, config)
    const offLayer = keymap.registerLayer({
      bindings: config.keybinds.gather("session", ["session.page.up", "session.page.down"]),
    })
    const bindings = keymap.getCommandBindings({
      visibility: "registered",
      commands: ["session.page.up", "session.page.down"],
    })
    sequences.up =
      bindings.get("session.page.up")?.map((binding) => binding.sequence.map((part) => part.stroke.name)) ?? []
    sequences.down =
      bindings.get("session.page.down")?.map((binding) => binding.sequence.map((part) => part.stroke.name)) ?? []
    onCleanup(() => {
      offLayer()
      offKeymap()
    })

    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <box />
      </OpencodeKeymapProvider>
    )
  }

  const app = await testRender(() => <Harness />)
  try {
    expect(sequences).toEqual({
      up: [["pageup"]],
      down: [["pagedown"]],
    })
  } finally {
    app.renderer.destroy()
  }
})

test("mode-less bindings stay active when opencode mode changes", async () => {
  const counts: Record<string, Record<string, number>> = {}

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createResolvedKeymapConfig()
    const offKeymap = registerOpencodeKeymap(keymap, renderer, config)
    const offGlobal = keymap.registerLayer({
      commands: [
        { name: "session.list", run() {} },
        { name: "session.new", run() {} },
        { name: "session.page.up", run() {} },
        { name: "session.first", run() {} },
      ],
      bindings: config.keybinds.gather("test.global", [
        "session.list",
        "session.new",
        "session.page.up",
        "session.first",
      ]),
    })
    const offBase = keymap.registerLayer({
      mode: OPENCODE_BASE_MODE,
      commands: [{ name: "model.list", run() {} }],
      bindings: config.keybinds.gather("test.base", ["model.list"]),
    })
    const activeCounts = () =>
      Object.fromEntries(
        Array.from(
          keymap.getCommandBindings({
            visibility: "active",
            commands: ["session.list", "session.new", "session.page.up", "session.first", "model.list"],
          }),
          ([command, bindings]) => [command, bindings.length],
        ),
      )

    counts.base = activeCounts()
    const popQuestion = getOpencodeModeStack(keymap).push("question")
    counts.question = activeCounts()
    popQuestion()
    const popAutocomplete = getOpencodeModeStack(keymap).push("autocomplete")
    counts.autocomplete = activeCounts()
    popAutocomplete()

    onCleanup(() => {
      offBase()
      offGlobal()
      offKeymap()
    })

    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <box />
      </OpencodeKeymapProvider>
    )
  }

  const app = await testRender(() => <Harness />)
  try {
    expect(counts).toEqual({
      base: { "session.list": 1, "session.new": 1, "session.page.up": 2, "session.first": 2, "model.list": 1 },
      question: { "session.list": 1, "session.new": 1, "session.page.up": 2, "session.first": 2, "model.list": 0 },
      autocomplete: {
        "session.list": 1,
        "session.new": 1,
        "session.page.up": 2,
        "session.first": 2,
        "model.list": 0,
      },
    })
  } finally {
    app.renderer.destroy()
  }
})

test("escape presses delivered in one read reach the single-press abort", async () => {
  const aborts: string[] = []

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createResolvedKeymapConfig({ session_abort: "alt+escape,ctrl+k" })
    const offKeymap = registerOpencodeKeymap(keymap, renderer, config)
    const offLayer = keymap.registerLayer({
      mode: OPENCODE_BASE_MODE,
      commands: [{ name: "session.abort", run: (ctx) => void aborts.push(JSON.stringify(ctx.event.raw)) }],
      bindings: config.keybinds.get("session.abort"),
    })
    onCleanup(() => {
      offLayer()
      offKeymap()
    })

    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <box />
      </OpencodeKeymapProvider>
    )
  }

  const app = await testRender(() => <Harness />)
  const read = async (bytes: string) => {
    app.renderer.stdin.emit("data", Buffer.from(bytes))
    await Bun.sleep(50)
  }
  try {
    await read("\x1b")
    await read("\x1b\x1b")
    await read("\x1b\x1b\x1b\x1b")
    await read("\x0b")
    expect(aborts).toEqual([JSON.stringify("\x1b\x1b"), JSON.stringify("\x1b\x1b\x1b\x1b"), JSON.stringify("\x0b")])
  } finally {
    app.renderer.destroy()
  }
})

// Home and End follow the editor-standard scheme: the prompt owns home/end with
// and without ctrl or shift, and conversation scrolling owns ctrl+alt+home/end.
// No default stroke is bound to both, so a key means the same thing whether or
// not the prompt has focus.
test("default input and messages keybinds share no key", () => {
  const keybinds = TuiKeybind.parse({})
  const strokes = (prefix: string) =>
    new Set(
      Object.entries(keybinds)
        .filter(([name]) => name.startsWith(prefix))
        .flatMap(([, value]) => (typeof value === "string" ? value.split(",") : []))
        .filter((key) => key !== "none"),
    )
  const input = strokes("input_")
  expect([...strokes("messages_")].filter((key) => input.has(key))).toEqual([])
})

test("home and end keys reach the prompt or the conversation, never both", async () => {
  const ran: string[] = []
  let editor: TextareaRenderable | undefined

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createResolvedKeymapConfig()
    const offKeymap = registerOpencodeKeymap(keymap, renderer, config)
    const offSession = keymap.registerLayer({
      mode: OPENCODE_BASE_MODE,
      commands: [
        { name: "session.first", run: () => void ran.push("session.first") },
        { name: "session.last", run: () => void ran.push("session.last") },
      ],
      bindings: config.keybinds.gather("session", ["session.first", "session.last"]),
    })
    onCleanup(() => {
      offSession()
      offKeymap()
    })

    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <textarea ref={(el: TextareaRenderable) => (editor = el)} focused initialValue={"one\ntwo"} />
      </OpencodeKeymapProvider>
    )
  }

  const app = await testRender(() => <Harness />)
  const press = async (bytes: string) => {
    app.renderer.stdin.emit("data", Buffer.from(bytes))
    await Bun.sleep(50)
  }
  try {
    if (!editor) throw new Error("textarea did not mount")
    editor.cursorOffset = 5
    await press("\x1b[1~") // home, as tmux sends it: start of the line "two"
    expect(editor.cursorOffset).toBe(4)
    await press("\x1b[1~") // home again stays there rather than stepping onto "one"
    expect(editor.cursorOffset).toBe(4)
    editor.cursorOffset = 1
    await press("\x1b[4~") // end, as tmux sends it: end of the line "one"
    expect(editor.cursorOffset).toBe(3)
    await press("\x1b[4~") // end again stays there rather than stepping onto "two"
    expect(editor.cursorOffset).toBe(3)
    editor.cursorOffset = 5
    await press("\x1b[1;5H") // ctrl+home: start of the prompt
    expect(editor.cursorOffset).toBe(0)
    await press("\x1b[1;5F") // ctrl+end: end of the prompt
    expect(editor.cursorOffset).toBe(7)
    expect(ran).toEqual([])

    await press("\x1b[1;7H") // ctrl+alt+home
    await press("\x1b[1;7F") // ctrl+alt+end
    expect(ran).toEqual(["session.first", "session.last"])
    expect(editor.cursorOffset).toBe(7)
    expect(editor.plainText).toBe("one\ntwo")
  } finally {
    app.renderer.destroy()
  }
})

test("leader then v runs the raw paste, and a terminal paste after the leader finds it still pending", async () => {
  const ran: string[] = []
  const pasted: { text: string; leader: boolean }[] = []
  let leaderActive = () => false

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createResolvedKeymapConfig()
    const offKeymap = registerOpencodeKeymap(keymap, renderer, config)
    const offLayer = keymap.registerLayer({
      commands: [{ name: "prompt.paste.raw", run: () => void ran.push("prompt.paste.raw") }],
      bindings: config.keybinds.get("prompt.paste.raw"),
    })
    leaderActive = () => keymap.getPendingSequence()[0]?.tokenName === "leader"
    onCleanup(() => {
      offLayer()
      offKeymap()
    })

    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <textarea
          focused
          onPaste={(event: { bytes: Uint8Array; preventDefault(): void }) => {
            event.preventDefault()
            pasted.push({ text: Buffer.from(event.bytes).toString(), leader: leaderActive() })
          }}
        />
      </OpencodeKeymapProvider>
    )
  }

  const app = await testRender(() => <Harness />)
  const press = async (bytes: string) => {
    app.renderer.stdin.emit("data", Buffer.from(bytes))
    await Bun.sleep(50)
  }
  try {
    await press("\x18") // ctrl+x, the default leader
    await press("v")
    expect(ran).toEqual(["prompt.paste.raw"])

    await press("\x1b[200~one\ntwo\nthree\x1b[201~")
    await press("\x18")
    await press("\x1b[200~one\ntwo\nthree\x1b[201~")
    expect(pasted).toEqual([
      { text: "one\ntwo\nthree", leader: false },
      { text: "one\ntwo\nthree", leader: true },
    ])
  } finally {
    app.renderer.destroy()
  }
})

// Byte forms measured through Vibeterm's tmux: \x1a from every terminal for ctrl+z; ctrl+shift+z
// as Ghostty's modifyOtherKeys report relayed by tmux (uppercase Z), its lowercase form, and the
// CSI-u forms Terminal.app's VibeTerm profile and kitty-protocol terminals send.
test("ctrl+z undoes and ctrl+shift+z redoes in the prompt in every byte form that reaches it", async () => {
  const ran: string[] = []

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createResolvedKeymapConfig()
    const offKeymap = registerOpencodeKeymap(keymap, renderer, config)
    const offLayer = keymap.registerLayer({
      commands: [
        { name: "input.undo", run: () => void ran.push("undo") },
        { name: "input.redo", run: () => void ran.push("redo") },
        { name: "terminal.suspend", run: () => void ran.push("suspend") },
      ],
      bindings: config.keybinds.gather("input", ["input.undo", "input.redo", "terminal.suspend"]),
    })
    onCleanup(() => {
      offLayer()
      offKeymap()
    })

    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <textarea focused />
      </OpencodeKeymapProvider>
    )
  }

  const app = await testRender(() => <Harness />)
  try {
    for (const bytes of ["\x1a", "\x1b[27;6;90~", "\x1b[27;6;122~", "\x1b[90;6u", "\x1b[122;6u"]) {
      app.renderer.stdin.emit("data", Buffer.from(bytes))
      await Bun.sleep(50)
    }
    expect(ran).toEqual(["undo", "redo", "redo", "redo", "redo"])
  } finally {
    app.renderer.destroy()
  }
})

test("ctrl+u follows input.line_discard in a textarea, on the caret's line only, and in an input", async () => {
  async function run(mode: LineDiscard | undefined, field: "textarea" | "input", text: string, caret: number) {
    let editor: TextareaRenderable | InputRenderable | undefined

    function Harness() {
      const renderer = useRenderer()
      const keymap = createDefaultOpenTuiKeymap(renderer)
      const offKeymap = registerOpencodeKeymap(keymap, renderer, {
        ...createResolvedKeymapConfig(),
        input: { line_discard: mode },
      })
      onCleanup(offKeymap)
      const ref = (el: TextareaRenderable) => (editor = el)

      return (
        <OpencodeKeymapProvider keymap={keymap}>
          {field === "textarea" ? (
            <textarea ref={ref} focused initialValue={text} />
          ) : (
            <input ref={ref} focused value={text} />
          )}
        </OpencodeKeymapProvider>
      )
    }

    const app = await testRender(() => <Harness />)
    try {
      if (!editor) throw new Error(`${field} did not mount`)
      editor.cursorOffset = caret
      app.renderer.stdin.emit("data", Buffer.from("\x15"))
      await Bun.sleep(50)
      const after = { text: editor.plainText, caret: editor.cursorOffset }
      editor.undo()
      return { ...after, undone: editor.plainText }
    } finally {
      app.renderer.destroy()
    }
  }

  expect(await run(undefined, "textarea", "hello world", 5)).toEqual({
    text: " world",
    caret: 0,
    undone: "hello world",
  })
  expect(await run("bash", "textarea", "hello world", 5)).toEqual({ text: " world", caret: 0, undone: "hello world" })
  expect(await run("zsh", "textarea", "hello world", 5)).toEqual({ text: "", caret: 0, undone: "hello world" })
  expect(await run("bash", "textarea", "first\nhello world\nlast", 11)).toEqual({
    text: "first\n world\nlast",
    caret: 6,
    undone: "first\nhello world\nlast",
  })
  expect(await run("zsh", "textarea", "first\nhello world\nlast", 11)).toEqual({
    text: "first\n\nlast",
    caret: 6,
    undone: "first\nhello world\nlast",
  })
  // A second press on the emptied line joins it to the previous one.
  expect(await run("zsh", "textarea", "first\n\nlast", 6)).toEqual({
    text: "first\nlast",
    caret: 5,
    undone: "first\n\nlast",
  })
  expect(await run("bash", "input", "hello world", 5)).toEqual({ text: " world", caret: 0, undone: "hello world" })
  expect(await run("zsh", "input", "hello world", 5)).toEqual({ text: "", caret: 0, undone: "hello world" })
})
