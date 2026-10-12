export * as TuiLayout from "./layout"

// Geometry of the home screen, the session screen and the prompt. The JSX in
// routes/home.tsx, routes/session, component/prompt and the home and sidebar
// feature plugins reads these, and so does the instant startup prompt, which
// paints the same screens before the TUI framework loads. Keep this module
// free of imports for that reason.

export const Home = {
  paddingX: 2,
  logoGapAbove: 4,
  // The gap above the logo shrinks to this, never to nothing, when the prompt needs the room.
  logoGapMin: 1,
  logoGapBelow: 1,
  promptPaddingTop: 1,
  tipsPaddingTop: 3,
  tipsMaxWidth: 75,
  footerPaddingX: 2,
  footerPaddingY: 1,
  footerGap: 2,
} as const

// Rows the home_bottom slot (the tips) takes before the startup cache has
// measured it: the tips' top padding and one line of tip.
export const defaultHomeBottomRows = Home.tipsPaddingTop + 1

export const Prompt = {
  borderWidth: 1,
  paddingX: 2,
  paddingTop: 1,
  metaPaddingTop: 1,
  metaGap: 1,
  statusGap: 2,
  defaultMaxWidth: 75,
  autoWidthRatio: 0.7,
  minMaxHeight: 6,
  maxHeightRatio: 1 / 3,
  statusInset: 1,
} as const

export const Session = {
  paddingX: 2,
  paddingBottom: 1,
  gap: 1,
  logPaddingTop: 1,
  wideWidth: 120,
} as const

export const Sidebar = {
  width: 42,
  paddingY: 1,
  paddingX: 2,
  contentPaddingRight: 1,
  titlePaddingRight: 1,
  gap: 1,
  footerPaddingTop: 1,
  footerGap: 1,
} as const

// The sidebar sits beside the transcript on a terminal wider than
// Session.wideWidth unless the user hid it ("sidebar" in kv.json), and as an
// overlay when opened on a narrower one. A subagent session never shows it.
export function sessionSidebarVisible(input: {
  width: number
  sidebar: "auto" | "hide"
  open: boolean
  child: boolean
}) {
  if (input.child) return false
  if (input.open) return true
  return input.sidebar === "auto" && input.width > Session.wideWidth
}

export function sessionContentWidth(width: number, sidebarVisible: boolean) {
  return width - (sidebarVisible ? Sidebar.width : 0) - 2 * Session.paddingX
}

// The session ID line under the sidebar title: kv.json's "sidebar_session_id"
// (the /session-id toggle) wins over tui.json's sidebar.session_id; with
// neither, development builds show it and release builds do not.
export function sidebarShowsSessionId(input: { kv?: unknown; configured?: boolean; channel: string }) {
  if (typeof input.kv === "boolean") return input.kv
  return input.configured ?? input.channel !== "latest"
}

// The tips toggle ("tips_hidden" in kv.json) wins over tui.json's home.tips; with neither the
// home screen shows a tip.
export function homeTipsShown(input: { kv?: unknown; configured?: boolean }) {
  if (typeof input.kv === "boolean") return !input.kv
  return input.configured ?? true
}

export const StartupLoading = {
  bottom: 1,
  paddingX: 1,
} as const

export const StartupNotice = {
  loading: "Loading…",
  queued: "OpenCode still loading, will submit shortly",
  changed: "Not submitted: agent/model/variant changed",
  sessionLoading: "Loading session…",
  gap: 1,
} as const

export const Spinner = {
  frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  interval: 80,
} as const

export const HomePlaceholders = {
  normal: ["Fix a TODO in the codebase", "What is the tech stack of this project?", "Fix broken tests"],
  shell: ["ls -la", "git status", "pwd"],
}

export function promptPlaceholder(mode: "normal" | "shell", example: string) {
  if (mode === "shell") return `Run a command… "${example}"`
  return `Ask anything… "${example}"`
}

// A prompt size from tui.json: a count of rows or columns, or a percentage such as "80%" of the
// space the prompt has once every other element has the room it always keeps.
export type Size = number | string

export type PromptPosition = "top" | "middle" | "bottom"

export function size(value: Size | undefined, space: number) {
  if (typeof value !== "string") return value
  return Math.max(1, Math.floor((space * Number(value.slice(0, -1))) / 100))
}

// A percentage is of the home column's width inside its padding.
export function homePromptMaxWidth(configured: Size | "auto" | undefined, terminalWidth: number) {
  if (configured === "auto") return Math.max(Prompt.defaultMaxWidth, Math.floor(terminalWidth * Prompt.autoWidthRatio))
  return size(configured, terminalWidth - 2 * Home.paddingX) ?? Prompt.defaultMaxWidth
}

// Rows the prompt adds around its text: the padding above it, the padding and agent/model row
// below it, the frame's bottom edge and the status row, which can wrap to `statusRows`.
export function promptChromeRows(statusRows: number) {
  return Prompt.paddingTop + Prompt.metaPaddingTop + 2 + statusRows
}

// The text area starts `min` rows tall and grows with its text up to `max`, then scrolls. `space`
// is the rows it has on screen: neither bound exceeds it, so the prompt never grows past the
// screen, and a percentage is of it. Where the space is not known yet, a percentage is of the
// terminal height and only the configured rows bound the text area.
export function promptRows(input: { min?: Size; max?: Size; terminalHeight: number; space?: number }) {
  const space = input.space === undefined ? undefined : Math.max(1, input.space)
  const fallback = Math.max(Prompt.minMaxHeight, Math.floor(input.terminalHeight * Prompt.maxHeightRatio))
  const configured = size(input.max, space ?? input.terminalHeight) ?? fallback
  const max = Math.max(1, Math.min(configured, space ?? configured))
  return { min: Math.min(max, Math.max(1, size(input.min, space ?? input.terminalHeight) ?? 1)), max }
}

// Rows the home prompt may take, chrome included: the home column less the logo with the row it
// always keeps above it, the update notice and the prompt's top padding. The gap below the logo
// and the tips give their rows up first.
export function homePromptSpace(input: { height: number; logo: number; notice: number }) {
  return input.height - (input.logo > 0 ? input.logo + Home.logoGapMin : 0) - input.notice - Home.promptPaddingTop
}

// The logo gives way on a terminal too short for it and a prompt with one row to type in.
export function homeLogoFits(input: { height: number; logo: number; notice: number }) {
  return homePromptSpace(input) - promptChromeRows(1) >= 1
}

// Rows the session prompt may take, chrome included: the transcript column less its bottom
// padding and the gap above the prompt. The transcript gives its rows up.
export function sessionPromptSpace(columnHeight: number) {
  return columnHeight - Session.paddingBottom - Session.gap
}

// The rows of the home column from the top: the spacer, the gap above the logo, the gap below it
// and the home_bottom block (the tips), given the logo's rows (0 when hidden) and the rows of
// everything from the update notice to the prompt's bottom. The prompt sits in the middle, or at
// the top or bottom with the logo above it. When the column is too short, the gaps and the tips
// shrink in proportion to their size, as flexbox would, the gap above the logo no further than
// Home.logoGapMin. The TUI sets these heights itself: Yoga does not shrink a box with a height.
export function homeStack(input: {
  height: number
  logo: number
  prompt: number
  bottom: number
  position: PromptPosition
}) {
  const gaps = input.logo > 0 ? [homeLogoGapAbove(input.position), Home.logoGapBelow] : [0, 0]
  const mins = [input.logo > 0 ? Home.logoGapMin : 0, 0, 0]
  const sizes = shrink([...gaps, input.bottom], mins, input.height - input.logo - input.prompt).map(Math.floor)
  const free = Math.max(0, input.height - input.logo - input.prompt - sizes.reduce((sum, value) => sum + value, 0))
  const spacer = input.position === "middle" ? free / 2 : input.position === "bottom" ? free : 0
  return { spacer, gapAbove: sizes[0], gapBelow: sizes[1], bottom: sizes[2] }
}

export function homeLogoGapAbove(position: PromptPosition) {
  return position === "middle" ? Home.logoGapAbove : Home.logoGapMin
}

// Flexbox shrinking: each size gives up room in proportion to itself until they fit in `room`;
// one that reaches its minimum stops there and the rest give up the remainder.
function shrink(sizes: number[], mins: number[], room: number) {
  const result = [...sizes]
  const frozen = sizes.map((value, index) => value <= mins[index])
  for (;;) {
    const over = result.reduce((sum, value) => sum + value, 0) - room
    const basis = sizes.reduce((sum, value, index) => (frozen[index] ? sum : sum + value), 0)
    if (over <= 0 || basis === 0) return result
    const next = result.map((value, index) => (frozen[index] ? value : sizes[index] - (over * sizes[index]) / basis))
    const fixed = next.map((value, index) => !frozen[index] && value < mins[index])
    if (!fixed.some(Boolean)) return next
    fixed.forEach((hit, index) => {
      if (!hit) return
      frozen[index] = true
      result[index] = mins[index]
    })
  }
}
