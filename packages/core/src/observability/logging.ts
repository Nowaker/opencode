import { Effect, FileSystem, Formatter, Latch, Logger, type LogLevel } from "effect"
import path from "path"
import { Global } from "../global"
import { runID } from "./shared"

function formatter(id: string = runID) {
  return Logger.map(Logger.formatStructured, (output) => {
    const messages = Array.isArray(output.message) ? output.message : [output.message]
    return [
      ["timestamp", output.timestamp],
      ["level", output.level],
      ["run", id],
      ...messages.flatMap((value) => (plain(value) ? flatten(value) : [["message", value] as const])),
      ...(output.cause === undefined ? [] : [["cause", output.cause] as const]),
      ...flatten(output.spans),
      ...flatten(output.annotations),
    ]
      .map(([key, value]) => `${key}=${format(value)}`)
      .join(" ")
  })
}

function flatten(
  input: Record<string, unknown>,
  prefix = "",
  seen = new WeakSet<object>(),
): Array<readonly [string, unknown]> {
  if (seen.has(input)) return [[prefix, "[Circular]"]]
  seen.add(input)
  const entries = Object.entries(input)
  if (entries.length === 0 && prefix) return [[prefix, input]]
  return entries.flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return plain(value) ? flatten(value, path, seen) : [[path, value] as const]
  })
}

function plain(input: unknown): input is Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return false
  const prototype = Object.getPrototypeOf(input)
  return prototype === Object.prototype || prototype === null
}

function format(input: unknown) {
  const value = typeof input === "string" ? input : Formatter.format(input)
  return /^[^\s="\\]+$/.test(value) ? value : JSON.stringify(value)
}

// Logger.toFile flushes on a timer that ticks every batch window forever, so an
// idle process wakes both its threads once a second to write nothing. This one
// sleeps until a line arrives and only then waits one window to batch writes.
export function fileLogger(file = path.join(Global.Path.log, "opencode.log"), id: string = runID) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const handle = yield* fs.open(file, { flag: "a" })
    const encoder = new TextEncoder()
    const log = formatter(id)
    const pending = yield* Latch.make()
    let lines: string[] = []
    const flush = Effect.suspend(() => {
      if (lines.length === 0) return Effect.void
      const batch = lines
      lines = []
      return Effect.ignore(handle.write(encoder.encode(batch.join("\n") + "\n")))
    })
    yield* pending.await.pipe(
      Effect.andThen(Effect.sleep("1 second")),
      Effect.andThen(pending.close),
      Effect.andThen(flush),
      Effect.forever,
      Effect.forkScoped,
    )
    yield* Effect.addFinalizer(() => flush)
    return Logger.make((options) => {
      lines.push(log.log(options))
      pending.openUnsafe()
    })
  })
}

const stderrLogger = Logger.make((options) => process.stderr.write(formatter().log(options) + "\n"))

export function minimumLogLevel() {
  const value = process.env.OPENCODE_LOG_LEVEL?.toUpperCase()
  const levels = {
    DEBUG: "Debug",
    INFO: "Info",
    WARN: "Warn",
    ERROR: "Error",
  } as const satisfies Record<string, LogLevel.LogLevel>
  return value && value in levels ? levels[value as keyof typeof levels] : levels.INFO
}

export function loggers() {
  return process.env.OPENCODE_PRINT_LOGS === "1" ? [fileLogger(), stderrLogger] : [fileLogger()]
}

export * as Logging from "./logging"
