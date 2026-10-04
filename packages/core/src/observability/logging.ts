import { Effect, Exit, FileSystem, Formatter, Logger, Option, Scope, type LogLevel } from "effect"
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

// Logger.toFile holds one descriptor for the life of the process, so a log
// rotator that renames the file aside would keep receiving every later line.
// Before each batch, reopen the path when it no longer names the open file:
// one stat per flush, nothing per line, and no signal for the rotator to send.
export function fileLogger(file = path.join(Global.Path.log, "opencode.log"), id: string = runID) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const encoder = new TextEncoder()
    const open = Effect.gen(function* () {
      const scope = yield* Scope.make()
      const handle = yield* fs.open(file, { flag: "a" }).pipe(Scope.provide(scope))
      return { scope, handle }
    })
    let current = yield* open
    // Finalizers run in reverse, so this closes after the batcher's final flush.
    yield* Effect.addFinalizer(() => Scope.close(current.scope, Exit.void))
    // Open the new file before closing the old one: if the reopen fails, the
    // batch still lands in the old file instead of being dropped.
    const reopen = Effect.gen(function* () {
      const next = yield* open
      yield* Scope.close(current.scope, Exit.void)
      current = next
    })
    return yield* Logger.batched(formatter(id), {
      // Do not set window to 0; it causes high idle CPU usage.
      window: 1000,
      flush: (output) =>
        Effect.gen(function* () {
          if (!(yield* sameFile(fs, file, current.handle))) yield* Effect.ignore(reopen)
          yield* current.handle.write(encoder.encode(output.join("\n") + "\n"))
        }).pipe(Effect.ignore),
    })
  })
}

// A missing path counts as moved, so a deleted log is recreated.
function sameFile(fs: FileSystem.FileSystem, file: string, handle: FileSystem.File) {
  return Effect.all([fs.stat(file), handle.stat]).pipe(
    Effect.map(
      ([named, held]) => named.dev === held.dev && Option.getOrUndefined(named.ino) === Option.getOrUndefined(held.ino),
    ),
    Effect.orElseSucceed(() => false),
  )
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
