import { randomUUID } from "node:crypto"
import type { TuiComposerTypingEvent, TuiComposerTypingObserver, TuiComposerTypingSubmit } from "@opencode-ai/plugin/tui"

export function createTypingObservers() {
  const observers = new Set<TuiComposerTypingObserver>()
  const sources = new Set<(observer: TuiComposerTypingObserver) => void>()
  return {
    get observed() { return observers.size > 0 },
    observe(observer: TuiComposerTypingObserver) {
      observers.add(observer)
      for (const source of sources) source(observer)
      return () => { observers.delete(observer) }
    },
    connect(source: (observer: TuiComposerTypingObserver) => void) {
      sources.add(source)
      for (const observer of observers) source(observer)
      return () => { sources.delete(source) }
    },
    event(event: TuiComposerTypingEvent) {
      for (const observer of observers) observer.event(event)
    },
    beforeSubmit(event: TuiComposerTypingSubmit) {
      return Promise.all([...observers].map((observer) => observer.beforeSubmit(event)))
    },
  }
}

export type TypingBuffer = {
  readonly text: string
  readonly spans: readonly { readonly start: number; readonly end: number; readonly text: string }[]
  readonly selection?: { readonly start: number; readonly end: number }
}

export function codePoints(text: string) {
  let count = 0
  for (const _ of text) count++
  return count
}

function countRange(buffer: TypingBuffer, start: number, end: number) {
  let count = 0
  let offset = start
  for (const span of buffer.spans) {
    if (span.start < start || span.end > end) continue
    count += codePoints(buffer.text.slice(offset, span.start)) + codePoints(span.text)
    offset = span.end
  }
  return count + codePoints(buffer.text.slice(offset, end))
}

export function createComposerTyping(input: {
  readonly observers: ReturnType<typeof createTypingObservers>
  readonly sessionID: () => string | undefined
  readonly buffer: () => TypingBuffer
}) {
  let draftID: string = randomUUID()
  let identity: TuiComposerTypingEvent | undefined
  let focused = false
  let capturing = false
  const context = (timeMs = Date.now()) => ({ draftID, sessionID: input.sessionID() ?? null, timeMs })
  const event = (value: TuiComposerTypingEvent) => input.observers.event(value)
  const disconnect = input.observers.connect((observer) => {
    if (!identity) return
    observer.event(identity)
    if (focused) observer.event({ ...context(), kind: "focus_gained" })
  })

  function focus(next: boolean) {
    if (next === focused) return
    focused = next
    if (identity) event({ ...context(), kind: next ? "focus_gained" : "focus_lost" })
  }

  function start(timeMs: number) {
    if (identity) return
    identity = { ...context(timeMs), kind: "started" }
    event(identity)
    if (focused) event({ ...context(timeMs), kind: "focus_gained" })
  }

  function edit(counts: { insertedChars: number; deletedChars: number; isPaste: boolean; pasteChars: number }, timeMs = Date.now()) {
    if (!counts.insertedChars && !counts.deletedChars) return
    start(timeMs)
    event({ ...context(timeMs), kind: "edit", ...counts })
  }

  return {
    get draftID() { return draftID },
    focus,
    edit,
    start,
    replace(id?: string, disposition?: "cleared" | string) {
      const wasFocused = focused
      focus(false)
      if (identity && disposition === "cleared") event({ ...context(), kind: "cleared" })
      else if (identity && disposition) event({ ...context(), kind: "abandoned", reason: disposition })
      draftID = id ?? randomUUID()
      identity = id === undefined ? undefined : { ...context(), kind: "restored" }
      if (identity) event(identity)
      focus(wasFocused)
    },
    capture<T>(work: () => T, options?: { pasteChars?: number; replaceSelection?: boolean }): T {
      if (capturing || !input.observers.observed) return work()
      const timeMs = Date.now()
      const before = input.buffer()
      capturing = true
      try {
        return work()
      } finally {
        capturing = false
        const after = input.buffer()
        const selection = options?.replaceSelection ? before.selection : undefined
        if (selection && selection.start !== selection.end) {
          const deletedChars = countRange(before, selection.start, selection.end)
          edit({
            deletedChars,
            insertedChars: options?.pasteChars ?? countRange(after, 0, after.text.length) - countRange(before, 0, before.text.length) + deletedChars,
            isPaste: options?.pasteChars !== undefined,
            pasteChars: options?.pasteChars ?? 0,
          }, timeMs)
        } else {
          let start = 0
          const limit = Math.min(before.text.length, after.text.length)
          while (start < limit && before.text.charCodeAt(start) === after.text.charCodeAt(start)) start++
          // A differing low surrogate belongs to the preceding high surrogate.
          if (start && /[\uD800-\uDBFF]/.test(before.text[start - 1])) start--
          let previousEnd = before.text.length
          let nextEnd = after.text.length
          while (previousEnd > start && nextEnd > start && before.text.charCodeAt(previousEnd - 1) === after.text.charCodeAt(nextEnd - 1)) {
            previousEnd--
            nextEnd--
          }
          if (previousEnd < before.text.length && /[\uDC00-\uDFFF]/.test(before.text[previousEnd])) {
            previousEnd++
            nextEnd++
          }
          edit({
            deletedChars: countRange(before, start, previousEnd),
            insertedChars: options?.pasteChars ?? countRange(after, start, nextEnd),
            isPaste: options?.pasteChars !== undefined,
            pasteChars: options?.pasteChars ?? 0,
          }, timeMs)
        }
      }
    },
    dispose() {
      focus(false)
      disconnect()
    },
  }
}
