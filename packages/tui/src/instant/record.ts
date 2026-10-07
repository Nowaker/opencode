export * as InstantRecord from "./record"

import type { RGBA } from "@opentui/core"
import { InstantCache } from "./cache"

type Pending = {
  theme?: InstantCache.Theme
  shortcuts?: InstantCache.Data["shortcuts"]
  directories: Record<string, Partial<InstantCache.Directory>>
  sessions: Record<string, Omit<InstantCache.Session, "at">>
}

let pending: Pending | undefined
let timer: ReturnType<typeof setTimeout> | undefined

export function hex(color: RGBA) {
  return (
    "#" +
    color
      .toInts()
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")
  )
}

// Collects what the TUI shows into the startup cache, written at most twice a
// second and once more on exit.
export function record(patch: {
  theme?: InstantCache.Theme
  shortcuts?: InstantCache.Data["shortcuts"]
  directory?: string
  entry?: Partial<InstantCache.Directory>
  session?: { id: string; entry: Omit<InstantCache.Session, "at"> }
}) {
  if (!pending) process.once("exit", flush)
  pending ??= { directories: {}, sessions: {} }
  if (patch.session) pending.sessions[patch.session.id] = patch.session.entry
  if (patch.theme) pending.theme = patch.theme
  if (patch.shortcuts) pending.shortcuts = patch.shortcuts
  if (patch.directory && patch.entry)
    pending.directories[patch.directory] = { ...pending.directories[patch.directory], ...patch.entry }
  timer ??= setTimeout(flush, 500)
  timer.unref?.()
}

function flush() {
  if (timer) clearTimeout(timer)
  timer = undefined
  const next = pending
  pending = undefined
  if (!next) return
  process.off("exit", flush)
  const at = Date.now()
  // The cache only speeds up the next start; a write that fails (read-only
  // data directory, full disk) must not disturb the running TUI.
  try {
    InstantCache.write((data) => ({
      ...data,
      theme: next.theme ?? data.theme,
      shortcuts: next.shortcuts ?? data.shortcuts,
      directories: {
        ...data.directories,
        ...Object.fromEntries(
          Object.entries(next.directories).map(([directory, entry]) => [
            directory,
            { ...data.directories[directory], ...entry, at },
          ]),
        ),
      },
      sessions: {
        ...data.sessions,
        ...Object.fromEntries(Object.entries(next.sessions).map(([id, entry]) => [id, { ...entry, at }])),
      },
    }))
  } catch {}
}
