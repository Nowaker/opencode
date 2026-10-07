export * as InstantCache from "./cache"

import fs from "fs"
import path from "path"
import { GlobalPath } from "@opencode-ai/core/global-path"
import { DatabaseLocation } from "@opencode-ai/core/database/location"
import { InstallationChannel } from "@opencode-ai/core/installation/version"

// What the full TUI last showed, so the instant startup prompt can paint the
// same agent, model, variant and colors before anything is resolved. The file
// sits beside the database the process would open (opencode.db ->
// opencode.tui-startup.json), so a different OPENCODE_DB, data directory or
// release channel gets its own cache, and nothing here touches SQLite.

export type Theme = {
  background: string
  backgroundPanel: string
  backgroundElement: string
  text: string
  textMuted: string
  border: string
  warning: string
  error: string
}

// Labels are stored as the prompt displayed them, so the instant prompt never
// formats anything itself.
export type Directory = {
  agent?: { name: string; label: string; color: string }
  model?: { providerID: string; modelID: string; label: string; provider: string }
  variant?: string
  auto?: boolean
  branch?: string
  homeBottomRows?: number
  at: number
}

export type Data = {
  version: 1
  theme?: Theme
  shortcuts?: { agents: string; commands: string }
  directories: Record<string, Directory>
}

// The agent, model and variant a queued submit was made with, compared with
// what the full TUI resolves before the submit goes through.
export function selection(entry: Directory | undefined) {
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

export function read(target = file()): Data | undefined {
  if (!target) return
  try {
    const data = JSON.parse(fs.readFileSync(target, "utf8"))
    if (data?.version !== 1 || typeof data.directories !== "object") return
    return data as Data
  } catch {
    return
  }
}

export function write(update: (data: Data) => Data, target = file()) {
  if (!target) return
  const next = update(read(target) ?? { version: 1, directories: {} })
  const kept = Object.entries(next.directories)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_DIRECTORIES)
  const temporary = `${target}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(temporary, JSON.stringify({ ...next, directories: Object.fromEntries(kept) }))
  fs.renameSync(temporary, target)
}
