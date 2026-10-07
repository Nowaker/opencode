export * as InstantFrame from "./frame"

import { TuiLayout } from "../layout"
import { logo } from "../logo"
import { abbreviateHome } from "../runtime"
import { InstantEditor } from "./editor"
import type { InstantCache } from "./cache"
import type { InstantConfig } from "./config"

// Paints the home screen exactly where routes/home.tsx and the prompt put it,
// using the geometry from layout.ts, as one string of ANSI output. Flexbox is
// resolved by hand: the home column centers its content between two growing
// spacers, the logo gaps and the home_bottom block shrink first when space
// runs out, and positions round half up the way Yoga rounds them.

export type Input = {
  width: number
  height: number
  config: InstantConfig.Settings
  theme?: InstantCache.Theme
  entry?: InstantCache.Directory
  shortcuts: { agents: string; commands: string }
  cwd: string
  home: string
  version: string
  editor: InstantEditor.Editor
  placeholder: string
  scroll: number
  queued: boolean
  spinner: number
}

export type Output = {
  grid: Cell[][]
  cursor: { x: number; y: number }
  text: { x: number; y: number; width: number; rows: number; scroll: number; lines: InstantEditor.Line[] }
  spinner: { x: number; y: number; style: string }[]
}

export type Rgb = [number, number, number]
export type Cell = { ch: string; fg?: Rgb; bg?: Rgb; bold?: boolean; inverse?: boolean; wide?: boolean }

function rgb(hex: string | undefined): Rgb | undefined {
  if (!hex) return
  const value = hex.replace("#", "")
  if (value.length === 8 && value.slice(6) === "00") return
  return [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16)) as Rgb
}

// theme/index.ts tint(), on 0-255 channels.
function tint(base: Rgb, overlay: Rgb, alpha: number): Rgb {
  return base.map((value, index) => Math.round(value + (overlay[index] - value) * alpha)) as Rgb
}

const width = (text: string) => (/^[\x20-\x7e]*$/.test(text) ? text.length : Bun.stringWidth(text))

export function layout(
  input: Pick<Input, "width" | "height" | "config" | "entry" | "cwd" | "home" | "version" | "editor">,
) {
  const H = TuiLayout.Home
  const P = TuiLayout.Prompt
  const footerLabel = abbreviateHome(input.cwd, input.home) + (input.entry?.branch ? ":" + input.entry.branch : "")
  const versionWidth = width(input.version)
  const footerTextWidth = Math.max(1, input.width - 2 * H.footerPaddingX - 2 * H.footerGap - versionWidth)
  const footerLines = InstantEditor.layout(footerLabel, footerTextWidth)
  const footerHeight = 2 * H.footerPaddingY + footerLines.length
  const homeHeight = input.height - footerHeight

  const inner = input.width - 2 * H.paddingX
  const promptWidth = Math.min(inner, TuiLayout.homePromptMaxWidth(input.config.promptMaxWidth, input.width))
  const promptX = Math.round(H.paddingX + (inner - promptWidth) / 2)
  const textWidth = promptWidth - P.borderWidth - 2 * P.paddingX
  const lines = InstantEditor.layout(input.editor.text, textWidth)
  const textRows = Math.min(
    Math.max(1, lines.length),
    TuiLayout.promptMaxHeight(input.config.promptMaxHeight, input.height),
  )
  const promptHeight = H.promptPaddingTop + P.paddingTop + textRows + P.metaPaddingTop + 3
  const logoHeight = logo.left.length
  const logoWidth = logo.left[0].length + 1 + logo.right[0].length
  const bottomRows = input.entry?.homeBottomRows ?? TuiLayout.defaultHomeBottomRows

  const shrinkable = [H.logoGapAbove, H.logoGapBelow, bottomRows]
  const fixed = logoHeight + promptHeight + shrinkable.reduce((sum, value) => sum + value, 0)
  const free = homeHeight - fixed
  const total = shrinkable.reduce((sum, value) => sum + value, 0)
  const [gapAbove, gapBelow] =
    free >= 0 || total === 0 ? shrinkable : shrinkable.map((value) => Math.max(0, value + (free * value) / total))
  const spacer = Math.max(0, free) / 2

  return {
    footer: { lines: footerLines, label: footerLabel, y: homeHeight + H.footerPaddingY, height: footerHeight },
    version: { x: input.width - H.footerPaddingX - versionWidth },
    logo: { x: Math.round(H.paddingX + (inner - logoWidth) / 2), y: Math.round(spacer + gapAbove) },
    prompt: {
      x: promptX,
      y: Math.round(spacer + gapAbove + logoHeight + gapBelow + H.promptPaddingTop),
      width: promptWidth,
      textX: promptX + P.borderWidth + P.paddingX,
      textWidth,
      textRows,
      lines,
    },
  }
}

export function render(input: Input): Output {
  const grid: Cell[][] = Array.from({ length: input.height }, () =>
    Array.from({ length: input.width }, () => ({ ch: " " })),
  )
  const theme = input.theme
  const background = rgb(theme?.background)
  const element = rgb(theme?.backgroundElement)
  const text = rgb(theme?.text)
  const muted = rgb(theme?.textMuted)
  const border = rgb(input.entry?.agent?.color) ?? rgb(theme?.border)
  for (const row of grid) for (const cell of row) cell.bg = background

  const put = (x: number, y: number, value: string, style: Omit<Cell, "ch"> = {}) => {
    if (y < 0 || y >= input.height) return x
    for (const char of value) {
      const w = width(char)
      if (x >= 0 && x + w <= input.width) {
        grid[y][x] = { ...style, bg: style.bg ?? grid[y][x].bg, ch: char, wide: w > 1 }
        if (w > 1) grid[y][x + 1] = { ch: "", bg: grid[y][x].bg }
      }
      x += w
    }
    return x
  }
  const fill = (x: number, y: number, count: number, bg: Rgb | undefined) => {
    if (y < 0 || y >= input.height) return
    for (let i = Math.max(0, x); i < Math.min(input.width, x + count); i++)
      grid[y][i] = { ch: " ", bg: bg ?? background }
  }

  const box = layout(input)
  const P = TuiLayout.Prompt

  const logoMuted = muted ?? [128, 128, 128]
  const logoText = text ?? [255, 255, 255]
  const paintLogo = (line: string, x: number, y: number, fg: Rgb, bold: boolean) => {
    const shadow = tint(background ?? [0, 0, 0], fg, 0.25)
    for (const char of line) {
      if (char === "_") put(x, y, " ", { fg, bg: shadow, bold })
      else if (char === "^") put(x, y, "▀", { fg, bg: shadow, bold })
      else if (char === "~") put(x, y, "▀", { fg: shadow, bold })
      else if (char === ",") put(x, y, "▄", { fg: shadow, bold })
      else put(x, y, char, { fg, bold })
      x++
    }
  }
  logo.left.forEach((line, index) => {
    paintLogo(line, box.logo.x, box.logo.y + index, logoMuted, false)
    paintLogo(logo.right[index], box.logo.x + line.length + 1, box.logo.y + index, logoText, true)
  })

  const prompt = box.prompt
  const contentX = prompt.x + P.borderWidth
  const contentWidth = prompt.width - P.borderWidth
  const metaY = prompt.y + P.paddingTop + prompt.textRows + P.metaPaddingTop
  for (let y = prompt.y; y <= metaY; y++) {
    put(prompt.x, y, "┃", { fg: border })
    fill(contentX, y, contentWidth, element)
  }
  const textY = prompt.y + P.paddingTop
  const scroll = Math.max(0, Math.min(input.scroll, prompt.lines.length - prompt.textRows))
  const selected = input.editor.selection()
  if (!input.editor.text) put(prompt.textX, textY, input.placeholder, { fg: muted, bg: element })
  for (let row = 0; row < prompt.textRows; row++) {
    const line = prompt.lines[row + scroll]
    if (!line) break
    for (const cell of line.cells) {
      const inverse = !!selected && cell.offset >= selected.start && cell.offset < selected.end
      put(prompt.textX + cell.col, textY + row, cell.text === "\t" ? "  " : cell.text, {
        fg: text,
        bg: element,
        inverse,
      })
    }
  }

  const entry = input.entry
  if (entry?.agent) {
    let x = put(prompt.textX, metaY, entry.agent.label, { fg: border, bg: element })
    if (entry.auto) x = put(x + 1, metaY, "auto", { fg: muted, bg: element })
    if (entry.model) {
      x = put(x + P.metaGap, metaY, "·", { fg: muted, bg: element })
      x = put(x + P.metaGap, metaY, entry.model.label, { fg: text, bg: element })
      x = put(x + P.metaGap, metaY, entry.model.provider, { fg: muted, bg: element })
      if (entry.variant) {
        x = put(x + P.metaGap, metaY, "·", { fg: muted, bg: element })
        put(x + P.metaGap, metaY, entry.variant, { fg: rgb(theme?.warning), bg: element, bold: true })
      }
    }
  }

  const bottomY = metaY + 1
  put(prompt.x, bottomY, element ? "╹" : " ", { fg: border })
  for (let x = contentX; x < contentX + contentWidth; x++) put(x, bottomY, element ? "▀" : " ", { fg: element })

  const statusY = bottomY + 1
  const notice = TuiLayout.StartupNotice
  const spinner: Output["spinner"] = []
  const right = [
    [input.shortcuts.agents, "agents"],
    [input.shortcuts.commands, "commands"],
  ]
  const rightWidth =
    right.reduce((sum, [key, label]) => sum + width(key) + 1 + width(label), 0) + P.statusGap * (right.length - 1)
  const noticeWidth = notice.marginLeft + 1 + notice.gap + width(notice.queued)
  if (input.queued) {
    const x = prompt.x + notice.marginLeft
    spinner.push({ x, y: statusY, style: sgr({ ch: "", fg: text, bg: background }) })
    put(x, statusY, TuiLayout.Spinner.frames[input.spinner % TuiLayout.Spinner.frames.length], { fg: text })
    put(x + 1 + notice.gap, statusY, notice.queued, { fg: text })
  }
  if (!input.queued || noticeWidth + P.statusGap + rightWidth <= prompt.width) {
    let x = prompt.x + prompt.width - rightWidth
    for (const [key, label] of right) {
      x = put(x, statusY, key, { fg: text })
      x = put(x + 1, statusY, label, { fg: muted }) + P.statusGap
    }
  }

  const H = TuiLayout.Home
  box.footer.lines.forEach((line, index) =>
    put(
      H.footerPaddingX,
      box.footer.y + index,
      box.footer.label.slice(line.start, line.cells.at(-1)?.end ?? line.start),
      {
        fg: muted,
      },
    ),
  )
  put(box.version.x, box.footer.y, input.version, { fg: muted })

  const loading = TuiLayout.StartupLoading
  const loadingWidth = 2 * loading.paddingX + 1 + notice.gap + width(notice.loading)
  const loadingX = Math.round((input.width - loadingWidth) / 2)
  const loadingY = input.height - 1 - loading.bottom
  const panel = rgb(theme?.backgroundPanel)
  fill(loadingX, loadingY, loadingWidth, panel)
  const frame = TuiLayout.Spinner.frames[input.spinner % TuiLayout.Spinner.frames.length]
  spinner.push({
    x: loadingX + loading.paddingX,
    y: loadingY,
    style: sgr({ ch: "", fg: muted, bg: panel ?? background }),
  })
  put(loadingX + loading.paddingX, loadingY, frame, { fg: muted, bg: panel })
  put(loadingX + loading.paddingX + 1 + notice.gap, loadingY, notice.loading, { fg: muted, bg: panel })

  const caret = InstantEditor.caretPosition(prompt.lines, input.editor.caret)
  return {
    grid,
    cursor: { x: prompt.textX + caret.col, y: textY + caret.row - scroll },
    text: { x: prompt.textX, y: textY, width: prompt.textWidth, rows: prompt.textRows, scroll, lines: prompt.lines },
    spinner,
  }
}

function sgr(cell: Cell) {
  const codes = ["0"]
  if (cell.bold) codes.push("1")
  if (cell.inverse) codes.push("7")
  if (cell.fg) codes.push(`38;2;${cell.fg.join(";")}`)
  if (cell.bg) codes.push(`48;2;${cell.bg.join(";")}`)
  return `\x1b[${codes.join(";")}m`
}

export function serialize(grid: Cell[][]) {
  const out: string[] = []
  grid.forEach((row, y) => {
    out.push(`\x1b[${y + 1};1H`)
    let last = ""
    for (const cell of row) {
      if (cell.ch === "") continue
      const style = sgr(cell)
      if (style !== last) out.push(style)
      last = style
      out.push(cell.ch)
    }
  })
  out.push("\x1b[0m")
  return out.join("")
}

// Repaints only the spinner glyphs, so animation costs a few bytes per frame.
export function spinnerFrame(output: Output, frame: number) {
  const glyph = TuiLayout.Spinner.frames[frame % TuiLayout.Spinner.frames.length]
  return output.spinner.map((at) => `\x1b[${at.y + 1};${at.x + 1}H${at.style}${glyph}`).join("") + "\x1b[0m"
}
