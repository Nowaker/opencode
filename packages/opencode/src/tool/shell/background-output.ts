import { createConnection } from "node:net"
import { Deferred, Effect, Latch, Schedule, Schema } from "effect"
import stripAnsi from "strip-ansi"
import type { Parameters } from "./prompt"

const MAX_LINE = 8192
const MAX_NOTICE_BYTES = 16_384
const MAX_NOTICE_LINES = 50
const BATCH_MS = 200
const BURST = 10
const REFILL_MS = 2_000

class InvalidBackgroundOptions extends Schema.TaggedErrorClass<InvalidBackgroundOptions>()("InvalidBackgroundOptions", {
  message: Schema.String,
}) {}

export const prepare = Effect.fnUntraced(function* (input: Parameters) {
  if (!input.ready && !input.notify) return
  if (input.run_in_background !== true) {
    return yield* new InvalidBackgroundOptions({ message: "ready and notify require run_in_background: true" })
  }
  if (input.ready && (input.ready.log === undefined) === (input.ready.port === undefined)) {
    return yield* new InvalidBackgroundOptions({ message: "ready needs exactly one of log or port" })
  }
  const { RE2JS, RE2JSSyntaxException } = yield* Effect.promise(() => import("re2js"))
  return yield* Effect.try({
    try: () => ({
      readyLog: input.ready?.log !== undefined ? RE2JS.compile(input.ready.log) : undefined,
      port: input.ready?.port,
      timeout: input.ready ? (input.ready.timeout ?? 10_000) : undefined,
      notify: input.notify?.map((pattern) => RE2JS.compile(pattern)) ?? [],
    }),
    catch: (error) => {
      if (!(error instanceof RE2JSSyntaxException)) throw error
      return new InvalidBackgroundOptions({ message: `Invalid Bash line regex: ${error.getDescription()}` })
    },
  })
})

function connect(port: number) {
  return Effect.callback<boolean>((resume) => {
    const socket = createConnection({ host: "127.0.0.1", port, timeout: 100 })
    socket.once("connect", () => {
      socket.destroy()
      resume(Effect.succeed(true))
    })
    socket.once("error", () => resume(Effect.succeed(false)))
    socket.once("timeout", () => {
      socket.destroy()
      resume(Effect.succeed(false))
    })
    return Effect.sync(() => {
      socket.destroy()
    })
  })
}

type Batch = {
  readonly sequence: number
  readonly lines: readonly string[]
  readonly suppressed: number
}

export function observe(options: NonNullable<Effect.Success<ReturnType<typeof prepare>>>) {
  const match = Deferred.makeUnsafe<void>()
  const pending = Latch.makeUnsafe()
  let watchLog = options.readyLog
  let fragment = ""
  let long = false
  let lines: string[] = []
  let bytes = 0
  let suppressed = 0
  let sequence = 0
  let tokens = BURST
  let replenishedAt = performance.now()

  function line(raw: string) {
    const text = stripAnsi(raw.endsWith("\r") ? raw.slice(0, -1) : raw)
    if (watchLog?.test(text)) {
      watchLog = undefined
      Deferred.doneUnsafe(match, Effect.void)
    }
    if (!options.notify.some((pattern) => pattern.test(text))) return
    const size = Buffer.byteLength(text)
    if (lines.length < MAX_NOTICE_LINES && bytes + size <= MAX_NOTICE_BYTES) {
      lines.push(text)
      bytes += size
    } else {
      suppressed++
    }
    pending.openUnsafe()
  }

  function append(chunk: string) {
    let start = 0
    while (start < chunk.length) {
      const newline = chunk.indexOf("\n", start)
      const end = newline === -1 ? chunk.length : newline
      if (!long) {
        if (fragment.length + end - start <= MAX_LINE) fragment += chunk.slice(start, end)
        else long = true
      }
      if (newline === -1) return
      if (!long) line(fragment)
      long = false
      fragment = ""
      start = newline + 1
    }
  }

  function take(): Batch {
    const batch = { sequence: ++sequence, lines, suppressed }
    lines = []
    bytes = 0
    suppressed = 0
    return batch
  }

  const drain = (publish: (batch: Batch) => Effect.Effect<void>) =>
    Effect.forever(
      pending.await.pipe(
        Effect.andThen(Effect.sleep(BATCH_MS)),
        Effect.andThen(
          Effect.suspend(() => {
            pending.closeUnsafe()
            const now = performance.now()
            const refilled = Math.floor((now - replenishedAt) / REFILL_MS)
            if (refilled > 0) {
              tokens = Math.min(BURST, tokens + refilled)
              replenishedAt += refilled * REFILL_MS
            }
            if (tokens === 0) {
              suppressed += lines.length
              lines = []
              bytes = 0
              return Effect.void
            }
            tokens--
            return publish(take())
          }).pipe(Effect.uninterruptible),
        ),
      ),
    )

  return {
    append,
    drain,
    finish: () => {
      watchLog = undefined
      if (!long && fragment) line(fragment)
      if (lines.length || suppressed) return take()
    },
    wait:
      options.port === undefined
        ? Deferred.await(match)
        : connect(options.port).pipe(Effect.repeat({ schedule: Schedule.spaced(100), until: Boolean }), Effect.asVoid),
    stopWaiting: () => {
      watchLog = undefined
    },
  }
}

export * as ShellBackgroundOutput from "./background-output"
