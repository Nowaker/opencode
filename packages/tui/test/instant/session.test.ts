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

  test("a drag anywhere outside the prompt marks the cells and copies their text on release", () => {
    const copied: string[] = []
    const home = InstantSession.create(create().init, undefined, { copy: (text) => copied.push(text) })
    const grid = home.compute(120, 40).grid
    const y = grid.findIndex((row) => row.map((cell) => cell.ch).join("").includes("1.0.0"))
    const x = grid[y].map((cell) => cell.ch).join("").indexOf("1.0.0")
    home.input(bytes(`\x1b[<0;${x + 1};${y + 1}M\x1b[<32;${x + 5};${y + 1}M`))
    const marked = home.compute(120, 40).grid[y]
    expect(marked.slice(x, x + 5).every((cell) => cell.inverse)).toBe(true)
    expect(marked[x + 5].inverse).toBeFalsy()
    expect(copied).toEqual([])
    home.input(bytes(`\x1b[<0;${x + 5};${y + 1}m`))
    expect(copied).toEqual(["1.0.0"])
    expect(home.action).toBeUndefined()
    // The mark stays shown until the next key.
    expect(home.compute(120, 40).grid[y][x].inverse).toBe(true)
    home.input(bytes("a"))
    expect(home.compute(120, 40).grid[y][x].inverse).toBeFalsy()
  })

  test("a drag across rows of the session screen copies them in reading order, a backward drag too", () => {
    const copied: string[] = []
    const session = InstantSession.create(createSession().init, undefined, { copy: (text) => copied.push(text) })
    const grid = session.compute(160, 40).grid
    const line = (y: number) => grid[y].map((cell) => cell.ch).join("")
    const titleY = grid.findIndex((_, y) => line(y).includes("Fix the build"))
    const titleX = line(titleY).indexOf("Fix the build")
    const idX = line(titleY + 1).indexOf("ses_a")
    const drag = (from: [number, number], to: [number, number]) =>
      session.input(
        bytes(`\x1b[<0;${from[0] + 1};${from[1] + 1}M\x1b[<32;${to[0] + 1};${to[1] + 1}M\x1b[<0;${to[0] + 1};${to[1] + 1}m`),
      )
    drag([titleX, titleY], [idX + 4, titleY + 1])
    drag([idX + 4, titleY + 1], [titleX, titleY])
    expect(copied).toHaveLength(2)
    expect(copied[0]).toBe(copied[1])
    expect(copied[0].split("\n").map((row) => row.trim())).toEqual(["Fix the build", "ses_a"])
  })

  test("a drag inside the prompt selects its text and copies it; a click copies nothing", () => {
    const copied: string[] = []
    const home = InstantSession.create(create().init, undefined, { copy: (text) => copied.push(text) })
    home.input(bytes("hello world"))
    const text = home.compute(120, 40).text
    const row = text.y + 1
    home.input(bytes(`\x1b[<0;${text.x + 1};${row}M\x1b[<0;${text.x + 1};${row}m`))
    expect(copied).toEqual([])
    home.input(bytes(`\x1b[<0;${text.x + 1};${row}M\x1b[<32;${text.x + 6};${row}M\x1b[<0;${text.x + 6};${row}m`))
    expect(copied).toEqual(["hello"])
    expect(home.editor.selection()).toEqual({ start: 0, end: 5 })
  })

  test("state carries over to a new session", () => {
    const first = create()
    first.input(bytes("hello\x1b[1;2D\x1b[1;2D"))
    const second = create(first.state())
    expect(second.editor.text).toBe("hello")
    expect(second.editor.selection()).toEqual(first.editor.selection())
  })
})
