export * as TuiLayout from "./layout"

// Geometry of the home screen and the prompt. The JSX in routes/home.tsx,
// component/prompt and the home feature plugins reads these, and so does the
// instant startup prompt, which paints the same screen before the TUI
// framework loads. Keep this module free of imports for that reason.

export const Home = {
  paddingX: 2,
  logoGapAbove: 4,
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
} as const

export const StartupLoading = {
  bottom: 1,
  paddingX: 1,
} as const

export const StartupNotice = {
  loading: "Loading…",
  queued: "OpenCode still loading, will submit shortly",
  changed: "Not submitted: agent/model/variant changed",
  marginLeft: 1,
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

export function homePromptMaxWidth(configured: number | "auto" | undefined, terminalWidth: number) {
  if (configured === "auto") return Math.max(Prompt.defaultMaxWidth, Math.floor(terminalWidth * Prompt.autoWidthRatio))
  return configured ?? Prompt.defaultMaxWidth
}

export function promptMaxHeight(configured: number | undefined, terminalHeight: number) {
  return configured ?? Math.max(Prompt.minMaxHeight, Math.floor(terminalHeight * Prompt.maxHeightRatio))
}
