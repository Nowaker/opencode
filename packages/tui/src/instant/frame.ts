export * as InstantFrame from "./frame"

import { TuiLayout } from "../layout"
import { logo } from "../logo"
import { abbreviateHome } from "../runtime"
import { InstantEditor } from "./editor"
import type { InstantCache } from "./cache"
import type { InstantConfig } from "./config"

// Paints the home screen or the session screen exactly where routes/home.tsx,
// routes/session and the prompt put them, using the geometry from layout.ts,
// as a grid of cells. Flexbox is resolved by hand: the home column centers its
// content between two growing spacers, the logo gaps and the home_bottom block
// shrink first when space runs out, and positions round half up the way Yoga
// rounds them. The session screen anchors the prompt to the bottom of the
// transcript column and puts the sidebar at the right edge.

// The session being opened: its ID (unknown for --continue), its cached
// title and prompt, the "sidebar" kv setting and whether the sidebar shows the
// session ID under the title.
export type SessionView = {
  id?: string
  entry?: InstantCache.Session
  sidebar: "auto" | "hide"
  idLine: boolean
}

export type Input = {
  width: number
  height: number
  config: InstantConfig.Settings
  theme?: Partial<InstantCache.Theme>
  entry?: InstantCache.Directory
  session?: SessionView
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
const spinnerGlyph = (frame: number) => TuiLayout.Spinner.frames[frame % TuiLayout.Spinner.frames.length]
const lineText = (text: string, line: InstantEditor.Line) =>
  text.slice(line.start, line.cells.at(-1)?.end ?? line.start)

// The status row under the prompt: what the right side holds and how many rows
// the left side wraps to. Only the left side shrinks (component/prompt).
function statusRow(input: Input, promptWidth: number) {
  const P = TuiLayout.Prompt
  const notice = TuiLayout.StartupNotice
  const noticeWidth = 1 + notice.gap + width(notice.queued)
  const usage = input.session?.entry?.usage
  const right: [string, string][] = usage
    ? [
        ["", usage],
        [input.shortcuts.commands, "commands"],
      ]
    : [
        [input.shortcuts.agents, "agents"],
        [input.shortcuts.commands, "commands"],
      ]
  const itemWidth = ([key, label]: [string, string]) => (key ? width(key) + 1 : 0) + width(label)
  const shortcutsWidth = right.reduce((sum, item) => sum + itemWidth(item), 0) + P.statusGap * (right.length - 1)
  const sessionNotice = !!input.session && input.queued
  const rightWidth = sessionNotice ? noticeWidth : shortcutsWidth
  const left = input.session ? input.cwd : ""
  const leftLines = left ? InstantEditor.layout(left, Math.max(1, promptWidth - rightWidth - P.statusInset)) : []
  return { right, usage, rightWidth, sessionNotice, noticeWidth, left, leftLines, rows: Math.max(1, leftLines.length) }
}

function promptGeometry(input: Input, promptWidth: number) {
  const P = TuiLayout.Prompt
  const textWidth = promptWidth - P.borderWidth - 2 * P.paddingX
  const lines = InstantEditor.layout(input.editor.text, textWidth)
  const textRows = Math.min(
    Math.max(1, lines.length),
    TuiLayout.promptMaxHeight(input.config.promptMaxHeight, input.height),
  )
  const status = statusRow(input, promptWidth)
  const height = P.paddingTop + textRows + P.metaPaddingTop + 2 + status.rows
  return { textWidth, lines, textRows, status, height }
}

export function layout(input: Input) {
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
  const geometry = promptGeometry(input, promptWidth)
  const promptHeight = H.promptPaddingTop + geometry.height
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
      ...geometry,
    },
  }
}

export function sessionLayout(input: Input & { session: SessionView }) {
  const S = TuiLayout.Session
  const P = TuiLayout.Prompt
  const sidebar = TuiLayout.sessionSidebarVisible({
    width: input.width,
    sidebar: input.session.sidebar,
    open: false,
    child: !!input.session.entry?.child,
  })
  const promptWidth = TuiLayout.sessionContentWidth(input.width, sidebar)
  const geometry = promptGeometry(input, promptWidth)
  return {
    sidebar,
    prompt: {
      x: S.paddingX,
      y: input.height - S.paddingBottom - geometry.height,
      width: promptWidth,
      textX: S.paddingX + P.borderWidth + P.paddingX,
      ...geometry,
    },
  }
}

type Canvas = ReturnType<typeof canvas>

function canvas(input: Input) {
  const grid: Cell[][] = Array.from({ length: input.height }, () =>
    Array.from({ length: input.width }, () => ({ ch: " " })),
  )
  const theme = input.theme
  const colors = {
    background: rgb(theme?.background),
    panel: rgb(theme?.backgroundPanel),
    element: rgb(theme?.backgroundElement),
    text: rgb(theme?.text),
    muted: rgb(theme?.textMuted),
    warning: rgb(theme?.warning),
    success: rgb(theme?.success),
  }
  for (const row of grid) for (const cell of row) cell.bg = colors.background
  const spinner: Output["spinner"] = []
  return {
    grid,
    colors,
    spinner,
    put(x: number, y: number, value: string, style: Omit<Cell, "ch"> = {}) {
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
    },
    fill(x: number, y: number, count: number, bg: Rgb | undefined) {
      if (y < 0 || y >= input.height) return
      for (let i = Math.max(0, x); i < Math.min(input.width, x + count); i++)
        grid[y][i] = { ch: " ", bg: bg ?? colors.background }
    },
    // A Spinner component: the glyph, a gap, then the label.
    spin(x: number, y: number, label: string, fg: Rgb | undefined, bg?: Rgb) {
      // A spinner pushed off a small terminal has no cell to animate.
      const cell = grid[y]?.[x]
      if (cell) spinner.push({ x, y, style: sgr({ ch: "", fg, bg: bg ?? cell.bg }) })
      this.put(x, y, spinnerGlyph(input.spinner), { fg, bg })
      return this.put(x + 1 + TuiLayout.StartupNotice.gap, y, label, { fg, bg })
    },
  }
}

type PromptBox = ReturnType<typeof layout>["prompt"]

function paintPrompt(c: Canvas, input: Input, prompt: PromptBox, selected: InstantCache.Selected | undefined) {
  const P = TuiLayout.Prompt
  const { element, text, muted, warning, background } = c.colors
  const border = rgb(selected?.agent?.color) ?? rgb(input.theme?.border)
  const contentX = prompt.x + P.borderWidth
  const contentWidth = prompt.width - P.borderWidth
  const metaY = prompt.y + P.paddingTop + prompt.textRows + P.metaPaddingTop
  for (let y = prompt.y; y <= metaY; y++) {
    c.put(prompt.x, y, "┃", { fg: border })
    c.fill(contentX, y, contentWidth, element)
  }
  const textY = prompt.y + P.paddingTop
  const scroll = Math.max(0, Math.min(input.scroll, prompt.lines.length - prompt.textRows))
  const range = input.editor.selection()
  if (!input.editor.text && input.placeholder) c.put(prompt.textX, textY, input.placeholder, { fg: muted, bg: element })
  for (let row = 0; row < prompt.textRows; row++) {
    const line = prompt.lines[row + scroll]
    if (!line) break
    for (const cell of line.cells) {
      const inverse = !!range && cell.offset >= range.start && cell.offset < range.end
      c.put(prompt.textX + cell.col, textY + row, cell.text === "\t" ? "  " : cell.text, {
        fg: text,
        bg: element,
        inverse,
      })
    }
  }

  if (selected?.agent) {
    let x = c.put(prompt.textX, metaY, selected.agent.label, { fg: border, bg: element })
    if (selected.auto) x = c.put(x + 1, metaY, "auto", { fg: muted, bg: element })
    if (selected.model) {
      x = c.put(x + P.metaGap, metaY, "·", { fg: muted, bg: element })
      x = c.put(x + P.metaGap, metaY, selected.model.label, { fg: text, bg: element })
      x = c.put(x + P.metaGap, metaY, selected.model.provider, { fg: muted, bg: element })
      if (selected.variant) {
        x = c.put(x + P.metaGap, metaY, "·", { fg: muted, bg: element })
        c.put(x + P.metaGap, metaY, selected.variant, { fg: warning, bg: element, bold: true })
      }
    }
  }

  const bottomY = metaY + 1
  c.put(prompt.x, bottomY, element ? "╹" : " ", { fg: border })
  for (let x = contentX; x < contentX + contentWidth; x++) c.put(x, bottomY, element ? "▀" : " ", { fg: element })

  const statusY = bottomY + 1
  const status = prompt.status
  status.leftLines.forEach((line, index) =>
    c.put(prompt.x + P.statusInset, statusY + index, lineText(status.left, line), { fg: muted }),
  )
  const right = prompt.x + prompt.width - status.rightWidth
  if (status.sessionNotice) {
    c.spin(right, statusY, TuiLayout.StartupNotice.queued, text, background)
  }
  if (input.queued && !input.session) {
    c.spin(prompt.x + P.statusInset, statusY, TuiLayout.StartupNotice.queued, text, background)
  }
  const homeNoticeFits = P.statusInset + status.noticeWidth + P.statusGap + status.rightWidth <= prompt.width
  if (!status.sessionNotice && (!input.queued || input.session || homeNoticeFits)) {
    let x = right
    for (const [key, label] of status.right) {
      if (key) x = c.put(x, statusY, key, { fg: text }) + 1
      x = c.put(x, statusY, label, { fg: muted }) + P.statusGap
    }
  }

  const caret = InstantEditor.caretPosition(prompt.lines, input.editor.caret)
  return {
    cursor: { x: prompt.textX + caret.col, y: textY + caret.row - scroll },
    text: { x: prompt.textX, y: textY, width: prompt.textWidth, rows: prompt.textRows, scroll, lines: prompt.lines },
  }
}

function paintHome(c: Canvas, input: Input) {
  const { background, text, muted, panel } = c.colors
  const box = layout(input)
  const logoMuted = muted ?? [128, 128, 128]
  const logoText = text ?? [255, 255, 255]
  const paintLogo = (line: string, x: number, y: number, fg: Rgb, bold: boolean) => {
    const shadow = tint(background ?? [0, 0, 0], fg, 0.25)
    for (const char of line) {
      if (char === "_") c.put(x, y, " ", { fg, bg: shadow, bold })
      else if (char === "^") c.put(x, y, "▀", { fg, bg: shadow, bold })
      else if (char === "~") c.put(x, y, "▀", { fg: shadow, bold })
      else if (char === ",") c.put(x, y, "▄", { fg: shadow, bold })
      else c.put(x, y, char, { fg, bold })
      x++
    }
  }
  logo.left.forEach((line, index) => {
    paintLogo(line, box.logo.x, box.logo.y + index, logoMuted, false)
    paintLogo(logo.right[index], box.logo.x + line.length + 1, box.logo.y + index, logoText, true)
  })

  const result = paintPrompt(c, input, box.prompt, input.entry)

  const H = TuiLayout.Home
  box.footer.lines.forEach((line, index) =>
    c.put(H.footerPaddingX, box.footer.y + index, lineText(box.footer.label, line), { fg: muted }),
  )
  c.put(box.version.x, box.footer.y, input.version, { fg: muted })

  const loading = TuiLayout.StartupLoading
  const notice = TuiLayout.StartupNotice
  const loadingWidth = 2 * loading.paddingX + 1 + notice.gap + width(notice.loading)
  const loadingX = Math.round((input.width - loadingWidth) / 2)
  const loadingY = input.height - 1 - loading.bottom
  c.fill(loadingX, loadingY, loadingWidth, panel)
  c.spin(loadingX + loading.paddingX, loadingY, notice.loading, muted, panel ?? background)
  return result
}

function paintSession(c: Canvas, input: Input & { session: SessionView }) {
  const S = TuiLayout.Session
  const B = TuiLayout.Sidebar
  const { text, muted, panel, success } = c.colors
  const box = sessionLayout(input)
  const selected = input.session.entry?.agent ? input.session.entry : input.entry

  c.spin(S.paddingX, S.logPaddingTop, TuiLayout.StartupNotice.sessionLoading, muted)
  const result = paintPrompt(c, input, box.prompt, selected)
  if (!box.sidebar) return result

  const left = input.width - B.width
  for (let y = 0; y < input.height; y++) c.fill(left, y, B.width, panel)
  const x = left + B.paddingX
  const inner = B.width - 2 * B.paddingX
  let y = B.paddingY
  const title = input.session.entry?.title ?? input.session.id
  if (title) {
    for (const line of InstantEditor.layout(title, inner - B.contentPaddingRight - B.titlePaddingRight))
      c.put(x, y++, lineText(title, line), { fg: text, bg: panel, bold: true })
    if (input.session.idLine && input.session.id) c.put(x, y++, input.session.id, { fg: muted, bg: panel })
    y += B.gap
  }
  c.spin(x, y, TuiLayout.StartupNotice.loading, muted, panel)

  // The sidebar footer: the directory, a gap, then "• OpenCode <version>".
  const path = abbreviateHome(input.cwd, input.home) + (input.entry?.branch ? ":" + input.entry.branch : "")
  const nameAt = path.lastIndexOf("/") + 1
  const pathLines = InstantEditor.layout(path, inner)
  const version = "• OpenCode " + input.version
  const versionLines = InstantEditor.layout(version, inner)
  const versionY = input.height - B.paddingY - versionLines.length
  const pathY = versionY - B.footerGap - pathLines.length
  pathLines.forEach((line, index) =>
    line.cells.forEach((cell) =>
      c.put(x + cell.col, pathY + index, cell.text, { fg: cell.offset < nameAt ? muted : text, bg: panel }),
    ),
  )
  const versionStyle = (offset: number): Omit<Cell, "ch"> => {
    if (offset === 0) return { fg: success, bg: panel }
    if (offset >= 2 && offset < 6) return { fg: muted, bg: panel, bold: true }
    if (offset >= 6 && offset < 10) return { fg: text, bg: panel, bold: true }
    return { fg: muted, bg: panel }
  }
  versionLines.forEach((line, index) =>
    line.cells.forEach((cell) => c.put(x + cell.col, versionY + index, cell.text, versionStyle(cell.offset))),
  )
  return result
}

export function render(input: Input): Output {
  const c = canvas(input)
  const result = input.session ? paintSession(c, { ...input, session: input.session }) : paintHome(c, input)
  return { grid: c.grid, spinner: c.spinner, ...result }
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
  return (
    output.spinner.map((at) => `\x1b[${at.y + 1};${at.x + 1}H${at.style}${spinnerGlyph(frame)}`).join("") + "\x1b[0m"
  )
}
