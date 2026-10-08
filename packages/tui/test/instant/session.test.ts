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
const createSession = () =>
  InstantSession.create({
    screen: true,
    config: { instantPrompt: true, earlyInput: true, keybinds: {}, mouse: true },
    session: { id: "ses_a", entry: { title: "Fix the build", at: 0 }, sidebar: "auto", idLine: true },
    cwd: "/work",
    home: "/home/user",
    version: "1.0.0",
    placeholder: 0,
  })
const widths = [1, 2, 3, 5, 8, 13, 20, 30, 40, 47, 50, 51, 55, 60, 75, 80, 100, 119, 120, 121, 125, 160]
const heights = [1, 2, 3, 5, 8, 10, 15, 20, 24, 30, 40, 45]

describe("instant session", () => {
  test("every terminal size paints and animates, home and session, idle and queued", () => {
    for (const make of [() => create(), createSession]) {
      for (const queued of [false, true]) {
        const session = make()
        if (queued) session.input(bytes("fix it\r"))
        for (const width of widths) {
          for (const height of heights) {
            session.compute(width, height)
            // The second frame of a size only moves the spinners.
            expect(() => session.compute(width, height)).not.toThrow()
            session.tick()
          }
        }
      }
    }
  })

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

  test("a click on the agent, model, hints or session title queues the command the TUI runs for it", () => {
    const click = (x: number, y: number) => `\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`
    const home = create()
    const frame = home.compute(120, 40)
    expect(frame.targets.map((target) => target.command)).toEqual([
      "agent.list",
      "model.list",
      "agent.cycle",
      "command.palette.show",
    ])
    for (const target of frame.targets) {
      home.input(bytes(click(target.x + target.width - 1, target.y)))
      expect(home.action).toBe(target.command)
    }
    const model = frame.targets.find((target) => target.command === "model.list")!
    home.input(bytes(click(model.x, model.y)))
    const pressed = home.compute(120, 40).grid[model.y].slice(model.x, model.x + model.width)
    expect(pressed.every((cell) => cell.inverse)).toBe(true)
    expect(create(home.state()).action).toBe("model.list")
    home.input(bytes("\x1b"))
    home.flushEscape()
    expect(home.action).toBeUndefined()

    const session = createSession()
    const title = session.compute(160, 40).targets.find((target) => target.command === "session.rename")!
    session.input(bytes(click(title.x, title.y)))
    expect(session.action).toBe("session.rename")
  })

  test("a press dragged off its cell queues nothing", () => {
    const session = create()
    const model = session.compute(120, 40).targets.find((target) => target.command === "model.list")!
    session.input(bytes(`\x1b[<0;${model.x + 1};${model.y + 1}M\x1b[<0;${model.x + 2};${model.y + 1}m`))
    expect(session.action).toBeUndefined()
  })

  test("state carries over to a new session", () => {
    const first = create()
    first.input(bytes("hello\x1b[1;2D\x1b[1;2D"))
    const second = create(first.state())
    expect(second.editor.text).toBe("hello")
    expect(second.editor.selection()).toEqual(first.editor.selection())
  })
})
