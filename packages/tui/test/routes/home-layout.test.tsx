import { describe, expect, test } from "bun:test"
import HomeTips from "../../src/feature-plugins/home/tips"
import HomeFooter from "../../src/feature-plugins/home/footer"
import { InstantEditor } from "../../src/instant/editor"
import { InstantFrame } from "../../src/instant/frame"
import type { InstantConfig } from "../../src/instant/config"
import type { Info } from "../../src/config"
import { withPrompt } from "../fixture/prompt-app"
import { directory } from "../fixture/tui-sdk"

type Options = { width: number; height: number; config?: Info; lines?: number; kv?: Record<string, unknown> }

// Where the screen put the logo, the prompt and the footer, read off the rendered frame.
function measure(frame: string) {
  const rows = frame.split("\n")
  const logo = rows.findIndex((row) => row.includes("█▀▀█ █▀▀█ █▀▀█"))
  const bars = rows.flatMap((row, index) => (row.trimStart().startsWith("┃") ? [index] : []))
  return {
    rows,
    logo: logo === -1 ? undefined : logo - 1,
    prompt: bars[0],
    // The bar runs down the padding, the text, the padding and the agent/model row.
    textRows: bars.length - 3,
    // The frame's bottom edge spans the prompt's width.
    width: (() => {
      const edge = rows.find((row) => row.includes("╹▀")) ?? ""
      return edge.trimEnd().length - edge.indexOf("╹")
    })(),
    status: rows.findIndex((row) => row.includes("ctrl+p commands")),
    footer: rows.findIndex((row) => row.includes(":main")),
    tip: rows.findIndex((row) => row.includes("● Tip")),
  }
}

async function home(options: Options, screen: "home" | "session" = "home") {
  let result: ReturnType<typeof measure> | undefined
  await withPrompt(
    async (rig) => {
      if (options.lines) await rig.press("x\n".repeat(options.lines))
      result = measure(await rig.settle())
    },
    {
      home: screen === "home",
      width: options.width,
      height: options.height,
      config: options.config,
      kv: options.kv,
      plugins: [HomeTips, HomeFooter],
    },
  )
  if (!result) throw new Error("the TUI did not render")
  return result
}

// The instant startup screen's input for the same terminal, settings and text.
function instantInput(options: Options): InstantFrame.Input {
  const config = options.config ?? {}
  const settings: InstantConfig.Settings = {
    instantPrompt: true,
    earlyInput: true,
    keybinds: {},
    mouse: true,
    promptMaxWidth: config.prompt?.max_width,
    promptMaxHeight: config.prompt?.max_height,
    promptMinHeight: config.prompt?.min_height,
    homeLogo: config.home?.logo,
    homeTips: config.home?.tips,
    homePromptPosition: config.home?.prompt_position,
  }
  return {
    width: options.width,
    height: options.height,
    config: settings,
    entry: { branch: "main", at: 0 },
    tips: config.home?.tips,
    shortcuts: { agents: "tab", commands: "ctrl+p" },
    cwd: directory,
    home: "/nonexistent",
    version: "local",
    editor: InstantEditor.create({ text: "x\n".repeat(options.lines ?? 0) }),
    placeholder: "",
    scroll: 0,
    queued: false,
    spinner: 0,
  }
}

const instant = (options: Options) => InstantFrame.layout(instantInput(options))

describe("home screen layout", () => {
  test("a prompt taller than the screen stays above the footer, one row below the logo's gap", async () => {
    const screen = await home({ width: 100, height: 30, lines: 40, config: { prompt: { max_height: 999 } } })
    expect(screen.logo).toBe(1)
    expect(screen.status).toBe(screen.footer - 2)
    expect(screen.textRows).toBe(16)
  }, 30_000)

  test("a small terminal keeps the prompt on screen at its default height", async () => {
    const screen = await home({ width: 60, height: 16, lines: 20 })
    expect(screen.status).toBeGreaterThan(0)
    expect(screen.status).toBeLessThan(screen.footer)
    expect(screen.logo).toBeGreaterThanOrEqual(1)
  }, 30_000)

  test("on a terminal too short for the logo and a row to type in, the logo gives way", async () => {
    const screen = await home({ width: 60, height: 12, lines: 3, config: { home: { tips: false } } })
    expect(screen.logo).toBeUndefined()
    // 9 rows above the footer less the padding and 5 rows around the text.
    expect(screen.textRows).toBe(3)
    expect(screen.status).toBe(screen.footer - 2)
  }, 30_000)

  test("top and bottom positions pin the logo and prompt, and the prompt grows away from the edge", async () => {
    const top = await home({ width: 100, height: 30, config: { home: { prompt_position: "top", tips: false } } })
    expect(top.logo).toBe(1)
    expect(top.prompt).toBe(1 + 4 + 1 + 1)
    const topTall = await home({
      width: 100,
      height: 30,
      lines: 5,
      config: { home: { prompt_position: "top", tips: false } },
    })
    expect(topTall.prompt).toBe(top.prompt)
    expect(topTall.status).toBe(top.status + 5)

    const bottom = await home({ width: 100, height: 30, config: { home: { prompt_position: "bottom", tips: false } } })
    expect(bottom.status).toBe(bottom.footer - 2)
    expect(bottom.prompt - bottom.logo!).toBe(4 + 1 + 1)
    const bottomTall = await home({
      width: 100,
      height: 30,
      lines: 5,
      config: { home: { prompt_position: "bottom", tips: false } },
    })
    expect(bottomTall.status).toBe(bottom.status)
    expect(bottomTall.prompt).toBe(bottom.prompt - 5)
    expect(bottomTall.prompt - bottomTall.logo!).toBe(4 + 1 + 1)
  }, 60_000)

  test("the logo and the tip can be hidden, and the tips toggle wins over home.tips", async () => {
    const shown = await home({ width: 100, height: 30 })
    expect(shown.logo).toBeDefined()
    expect(shown.tip).toBeGreaterThan(shown.status)
    const hidden = await home({ width: 100, height: 30, config: { home: { logo: false, tips: false } } })
    expect(hidden.logo).toBeUndefined()
    expect(hidden.tip).toBe(-1)
    const toggled = await home({
      width: 100,
      height: 30,
      config: { home: { tips: false } },
      kv: { tips_hidden: false },
    })
    expect(toggled.tip).toBeGreaterThan(toggled.status)
  }, 60_000)

  test("min_height starts the prompt taller, and percentages size it from the room it has", async () => {
    const start = await home({ width: 100, height: 30, config: { prompt: { min_height: 5 } } })
    expect(start.textRows).toBe(5)
    // 27 rows above the footer: the logo and the row above it, the padding and 5 rows around the text leave 16.
    const percent = await home({
      width: 100,
      height: 30,
      lines: 40,
      config: { prompt: { min_height: "25%", max_height: "50%", max_width: "50%" } },
    })
    expect(percent.textRows).toBe(8)
    expect(percent.width).toBe(48)
    const empty = await home({ width: 100, height: 30, config: { prompt: { min_height: "25%" } } })
    expect(empty.textRows).toBe(4)
  }, 60_000)

  const cases: Options[] = [
    { width: 100, height: 30, config: { home: { tips: false } } },
    { width: 100, height: 30, lines: 40, config: { prompt: { max_height: 999 }, home: { tips: false } } },
    { width: 60, height: 16, lines: 20, config: { home: { tips: false } } },
    {
      width: 120,
      height: 50,
      lines: 12,
      config: { prompt: { min_height: "20%", max_height: "60%" }, home: { tips: false } },
    },
    { width: 100, height: 30, lines: 3, config: { home: { prompt_position: "top", tips: false } } },
    { width: 100, height: 30, lines: 30, config: { home: { prompt_position: "bottom", tips: false } } },
    { width: 80, height: 20, lines: 4, config: { home: { prompt_position: "bottom", logo: false, tips: false } } },
    { width: 80, height: 12, lines: 10, config: { prompt: { max_height: "100%" }, home: { tips: false } } },
    { width: 60, height: 12, lines: 3, config: { home: { tips: false } } },
    { width: 60, height: 13, lines: 3, config: { home: { prompt_position: "top", tips: false } } },
  ]
  for (const options of cases)
    test(`the instant screen paints the same layout: ${JSON.stringify(options)}`, async () => {
      const screen = await home(options)
      const frame = instant(options)
      expect({ logo: screen.logo, prompt: screen.prompt, textRows: screen.textRows }).toEqual({
        logo: frame.logo?.y,
        prompt: frame.prompt.y,
        textRows: frame.prompt.textRows,
      })
    }, 30_000)
})

describe("session prompt layout", () => {
  test("a prompt taller than the screen stays on it", async () => {
    const screen = await home({ width: 100, height: 24, lines: 40, config: { prompt: { max_height: 999 } } }, "session")
    const last = screen.rows.findLastIndex((row) => row.includes("interrupt"))
    expect(last).toBe(24 - 2)
    expect(screen.prompt).toBe(1)
  }, 30_000)

  test("the instant session screen sizes the prompt the same way", async () => {
    for (const options of [
      { width: 100, height: 24, lines: 40, config: { prompt: { max_height: 999 } } },
      { width: 100, height: 24, lines: 2, config: { prompt: { min_height: "30%", max_height: "50%" } } },
    ] satisfies Options[]) {
      const screen = await home(options, "session")
      const frame = InstantFrame.sessionLayout({
        ...instantInput(options),
        session: { id: "ses_prompt_app", sidebar: "auto", idLine: false },
      })
      expect({ prompt: screen.prompt, textRows: screen.textRows }).toEqual({
        prompt: frame.prompt.y,
        textRows: frame.prompt.textRows,
      })
    }
  }, 60_000)

  test("min_height and a percentage max_height size the session prompt", async () => {
    const start = await home({ width: 100, height: 24, config: { prompt: { min_height: 4 } } }, "session")
    expect(start.textRows).toBe(4)
    // 24 rows less the bottom padding, the gap and 5 rows around the text leave 17; half is 8.
    const half = await home({ width: 100, height: 24, lines: 30, config: { prompt: { max_height: "50%" } } }, "session")
    expect(half.textRows).toBe(8)
  }, 30_000)
})
