import fs from "fs"
import path from "path"
import { runID } from "./shared"

// Errors a process survives but would otherwise drop - the TUI worker catches
// every uncaught exception and unhandled rejection so that one bad promise
// cannot take the session down - written as one JSON line each, so whoever
// watches the process can still find out they happened and where.
//
// A record holds the error's type, message and stack, which process and run
// wrote it, the version and the time. Nothing else: no environment, argv or
// arguments, which are where credentials and prompts end up. Writing is one
// synchronous append, because the hooks it serves may be the last thing the
// process runs, and it never throws.

export const MAX_PER_MINUTE = 30
export const MAX_FILE_BYTES = 1024 * 1024
const MAX_MESSAGE = 2_000
const MAX_FRAMES = 50

export type Origin = "uncaughtException" | "unhandledRejection"

export interface Options {
  readonly file: string
  readonly process: string
  readonly version: string
  readonly now?: () => number
}

function truncate(text: string) {
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}...` : text
}

function describe(thrown: unknown) {
  if (thrown instanceof Error) {
    const lines = typeof thrown.stack === "string" ? thrown.stack.split("\n") : []
    let frames = 0
    const stack = lines
      .filter((line) => !line.trimStart().startsWith("at ") || ++frames <= MAX_FRAMES)
      .map((line) => truncate(line))
      .join("\n")
    return {
      type: thrown.name || "Error",
      message: truncate(thrown.message),
      ...(stack === "" ? {} : { stack }),
    }
  }
  let text: string
  try {
    text = typeof thrown === "string" ? thrown : (JSON.stringify(thrown) ?? String(thrown))
  } catch {
    text = String(thrown)
  }
  return { type: "NonErrorThrown", message: truncate(text) }
}

export function writer(options: Options) {
  const now = options.now ?? Date.now
  let windowStart = 0
  let windowCount = 0
  return {
    record(thrown: unknown, origin: Origin) {
      try {
        const at = now()
        if (at - windowStart >= 60_000) {
          windowStart = at
          windowCount = 0
        }
        if (++windowCount > MAX_PER_MINUTE) return
        const line = JSON.stringify({
          schema: 1,
          time: new Date(at).toISOString(),
          version: options.version,
          run: runID,
          process: options.process,
          origin,
          ...describe(thrown),
        })
        fs.mkdirSync(path.dirname(options.file), { recursive: true })
        const size = fs.statSync(options.file, { throwIfNoEntry: false })?.size ?? 0
        if (size >= MAX_FILE_BYTES) fs.renameSync(options.file, `${options.file}.1`)
        fs.appendFileSync(options.file, `${line}\n`, { mode: 0o600 })
      } catch {
        // Recording an error must never become an error of its own.
      }
    },
  }
}

export * as ErrorRecord from "./error-record"
