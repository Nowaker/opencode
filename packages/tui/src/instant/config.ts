export * as InstantConfig from "./config"

import fs from "fs"
import path from "path"
import { parse } from "jsonc-parser"
import { GlobalPath } from "@opencode-ai/core/global-path"

// The handful of tui.json settings the instant startup prompt needs, read with
// plain file I/O from the global config, OPENCODE_TUI_CONFIG and
// OPENCODE_CONFIG_DIR. Project-level tui.json files apply once the full TUI
// has loaded, so a project that changes prompt width shows the change then.

export type Settings = {
  instantPrompt: boolean
  earlyInput: boolean
  promptMaxWidth?: number | "auto"
  promptMaxHeight?: number
  keybinds: Record<string, unknown>
  mouse: boolean
  cursor?: { style: "block" | "underline" | "line" | "default"; blinking: boolean }
}

type Raw = Record<string, unknown>

const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value)

function load(file: string): Raw {
  const text = (() => {
    try {
      return fs.readFileSync(file, "utf8")
    } catch {
      return undefined
    }
  })()
  if (!text) return {}
  const data: unknown = parse(text, [], { allowTrailingComma: true })
  if (!isRecord(data)) return {}
  return isRecord(data.tui) ? { ...data, ...data.tui } : data
}

function merge(base: Raw, next: Raw): Raw {
  return Object.fromEntries(
    [...new Set([...Object.keys(base), ...Object.keys(next)])].map((key) => {
      const a = base[key]
      const b = next[key]
      if (isRecord(a) && isRecord(b)) return [key, { ...a, ...b }]
      return [key, b === undefined ? a : b]
    }),
  )
}

const inDirectory = (dir: string) => [path.join(dir, "tui.json"), path.join(dir, "tui.jsonc")]

export function files(env: NodeJS.ProcessEnv = process.env) {
  return [
    ...inDirectory(GlobalPath.paths.config),
    ...(env.OPENCODE_TUI_CONFIG ? [env.OPENCODE_TUI_CONFIG] : []),
    ...(env.OPENCODE_CONFIG_DIR ? inDirectory(env.OPENCODE_CONFIG_DIR) : []),
  ]
}

export function read(env: NodeJS.ProcessEnv = process.env): Settings {
  const raw = files(env).map(load).reduce(merge, {})
  const startup = isRecord(raw.startup) ? raw.startup : {}
  const prompt = isRecord(raw.prompt) ? raw.prompt : {}
  const cursor = isRecord(raw.cursor) ? raw.cursor : undefined
  const disableMouse = env.OPENCODE_DISABLE_MOUSE?.toLowerCase()
  const positive = (value: unknown) =>
    typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined
  return {
    instantPrompt: startup.instant_prompt !== false,
    earlyInput: startup.early_input !== false,
    promptMaxWidth: prompt.max_width === "auto" ? "auto" : positive(prompt.max_width),
    promptMaxHeight: positive(prompt.max_height),
    keybinds: isRecord(raw.keybinds) ? raw.keybinds : {},
    mouse: raw.mouse !== false && disableMouse !== "1" && disableMouse !== "true",
    cursor: cursor
      ? {
          style:
            cursor.style === "underline" || cursor.style === "line" || cursor.style === "default"
              ? cursor.style
              : "block",
          blinking: cursor.blinking !== false,
        }
      : undefined,
  }
}
