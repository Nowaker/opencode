import { describe, expect, test } from "bun:test"
import { InstantSession } from "../../src/instant/session"

const create = (state?: InstantSession.State) =>
  InstantSession.create(
    {
      screen: true,
      config: { instantPrompt: true, earlyInput: true, keybinds: {}, mouse: true },
      entry: {
        agent: { name: "build", label: "Build", color: "#5c9cf5" },
        model: { providerID: "p", modelID: "m", label: "M", provider: "P" },
        at: 0,
      },
      cwd: "/work",
      home: "/home/user",
      version: "1.0.0",
      placeholder: 0,
    },
    state,
  )
const bytes = (text: string) => new TextEncoder().encode(text)

describe("instant session", () => {
  test("a click in the same read as the typing lands on the typed text", () => {
    const session = create()
    const frame = session.compute(120, 40)
    const x = frame.text.x + 1 + 1
    const y = frame.text.y + 1
    session.input(bytes(`hello world\x1b[D\x1b[D\x1b[DX\x1b[<0;${x};${y}M\x1b[<0;${x};${y}mY`))
    expect(session.editor.text).toBe("hYello woXrld")
  })

  test("a line feed in the first read is an Enter typed before raw mode and is dropped", () => {
    const session = create()
    session.input(bytes("abc\ndef"), true)
    expect(session.editor.text).toBe("abcdef")
    expect(session.queued).toBeUndefined()
  })

  test("Enter queues the submit with the selection the screen shows", () => {
    const session = create()
    session.input(bytes("fix it\r"))
    expect(session.queued).toEqual({ selection: { agent: "build", providerID: "p", modelID: "m", variant: undefined } })
    session.input(bytes("\x1b"))
    session.flushEscape()
    expect(session.queued).toBeUndefined()
  })

  test("ctrl+c quits only while the prompt is empty", () => {
    const session = create()
    session.input(bytes("x"))
    expect(session.input(bytes("\x03"))).toBeUndefined()
    expect(session.editor.text).toBe("")
    expect(session.input(bytes("\x03"))).toBe("quit")
  })

  test("state carries over to a new session", () => {
    const first = create()
    first.input(bytes("hello\x1b[1;2D\x1b[1;2D"))
    const second = create(first.state())
    expect(second.editor.text).toBe("hello")
    expect(second.editor.selection()).toEqual(first.editor.selection())
  })
})
