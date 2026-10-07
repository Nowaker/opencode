export * as InstantCache from "./cache"

import fs from "fs"
import path from "path"
import { GlobalPath } from "@opencode-ai/core/global-path"
import { DatabaseLocation } from "@opencode-ai/core/database/location"
import { InstallationChannel } from "@opencode-ai/core/installation/version"

// What the full TUI last showed, so the instant startup prompt can paint the
// same agent, model, variant, colors and session titles before anything is
// resolved. The file sits beside the database the process would open
// (opencode.db -> opencode.tui-startup.json), so a different OPENCODE_DB, data
// directory or release channel gets its own cache, and nothing here touches
// SQLite.

const THEME_KEYS = [
  "background",
  "backgroundPanel",
  "backgroundElement",
  "text",
  "textMuted",
  "border",
  "warning",
  "error",
  "success",
] as const
export type Theme = Record<(typeof THEME_KEYS)[number], string>

// Labels are stored as the prompt displayed them, so the instant prompt never
// formats anything itself.
export type Selected = {
  agent?: { name: string; label: string; color: string }
  model?: { providerID: string; modelID: string; label: string; provider: string }
  variant?: string
  auto?: boolean
}

export type Directory = Selected & {
  branch?: string
  homeBottomRows?: number
  at: number
}

// A session's prompt as last shown: its selection, the usage line, its title,
// and whether it is a subagent session (no sidebar).
export type Session = Selected & {
  title?: string
  child?: boolean
  usage?: string
  at: number
}

export type Data = {
  version: 1
  theme?: Partial<Theme>
  shortcuts?: { agents: string; commands: string }
  directories: Record<string, Directory>
  sessions?: Record<string, Session>
}

// The agent, model and variant a queued submit was made with, compared with
// what the full TUI resolves before the submit goes through.
export function selection(entry: Selected | undefined) {
  if (!entry?.agent || !entry.model) return
  return {
    agent: entry.agent.name,
    providerID: entry.model.providerID,
    modelID: entry.model.modelID,
    variant: entry.variant,
  }
}
export type Selection = NonNullable<ReturnType<typeof selection>>

const MAX_DIRECTORIES = 100
const MAX_SESSIONS = 300

export function file(env: NodeJS.ProcessEnv = process.env) {
  const db = DatabaseLocation.resolve({
    data: GlobalPath.paths.data,
    db: env.OPENCODE_DB,
    channel: InstallationChannel,
    disableChannelDb: env.OPENCODE_DISABLE_CHANNEL_DB,
  })
  if (db === ":memory:") return
  return path.join(path.dirname(db), path.parse(db).name + ".tui-startup.json")
}

// This and other opencode versions write the file, and it can be edited by
// hand, so read() keeps only fields of the expected type: a damaged file paints
// less, it never stops opencode from starting.
export function read(target = file()): Data | undefined {
  if (!target) return
  const data = record(load(target))
  if (data?.version !== 1) return
  return {
    version: 1,
    theme: theme(data.theme),
    shortcuts: pick<NonNullable<Data["shortcuts"]>>(data.shortcuts, { agents: text, commands: text }),
    directories: entries(data.directories, directory),
    sessions: entries(data.sessions, session),
  }
}

export function write(update: (data: Data) => Data, target = file()) {
  if (!target) return
  const next = update(read(target) ?? { version: 1, directories: {} })
  const newest = <T extends { at: number }>(entries: Record<string, T>, max: number) =>
    Object.fromEntries(
      Object.entries(entries)
        .sort((a, b) => b[1].at - a[1].at)
        .slice(0, max),
    )
  const temporary = `${target}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(
    temporary,
    JSON.stringify({
      ...next,
      directories: newest(next.directories, MAX_DIRECTORIES),
      sessions: newest(next.sessions ?? {}, MAX_SESSIONS),
    }),
  )
  fs.renameSync(temporary, target)
}

function load(target: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(target, "utf8"))
  } catch {
    return
  }
}

function record(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return
  return value as Record<string, unknown>
}

const text = (value: unknown) => (typeof value === "string" ? value : undefined)
const color = (value: unknown) =>
  typeof value === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value) ? value : undefined

// The listed fields when every one of them passes its check, else nothing.
function pick<T>(value: unknown, checks: { [K in keyof T]: (value: unknown) => T[K] | undefined }) {
  const input = record(value)
  if (!input) return
  const out: Partial<T> = {}
  for (const key in checks) {
    const item = checks[key](input[key])
    if (item === undefined) return
    out[key] = item
  }
  return out as T
}

function entries<T>(value: unknown, check: (value: unknown) => T | undefined) {
  return Object.fromEntries(
    Object.entries(record(value) ?? {}).flatMap(([key, item]) => {
      const entry = check(item)
      return entry === undefined ? [] : [[key, entry] as const]
    }),
  )
}

function theme(value: unknown) {
  const input = record(value)
  if (!input) return
  return Object.fromEntries(
    THEME_KEYS.flatMap((key) => {
      const hex = color(input[key])
      return hex ? [[key, hex] as const] : []
    }),
  ) as Partial<Theme>
}

function selected(input: Record<string, unknown>): Selected {
  return {
    agent: pick<NonNullable<Selected["agent"]>>(input.agent, { name: text, label: text, color }),
    model: pick<NonNullable<Selected["model"]>>(input.model, {
      providerID: text,
      modelID: text,
      label: text,
      provider: text,
    }),
    variant: text(input.variant),
    auto: typeof input.auto === "boolean" ? input.auto : undefined,
  }
}

function directory(value: unknown): Directory | undefined {
  const input = record(value)
  if (!input || typeof input.at !== "number") return
  const rows = input.homeBottomRows
  return {
    ...selected(input),
    branch: text(input.branch),
    homeBottomRows: typeof rows === "number" && Number.isInteger(rows) && rows >= 0 ? rows : undefined,
    at: input.at,
  }
}

function session(value: unknown): Session | undefined {
  const input = record(value)
  if (!input || typeof input.at !== "number") return
  return {
    ...selected(input),
    title: text(input.title),
    child: typeof input.child === "boolean" ? input.child : undefined,
    usage: text(input.usage),
    at: input.at,
  }
}
