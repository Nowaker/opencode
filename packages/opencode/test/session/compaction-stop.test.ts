import { expect } from "bun:test"
import { LLMEvent, Usage } from "@opencode-ai/llm"
import { APICallError } from "ai"
import { Effect, Layer, Stream } from "effect"
import { SessionCompaction } from "@/session/compaction"
import { Session } from "@/session/session"
import { compactionStopCase, records } from "./compaction-stop.fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)
const start = LLMEvent.textStart({ id: "text" })
const delta = (text: string) => LLMEvent.textDelta({ id: "text", text })
const end = LLMEvent.textEnd({ id: "text" })

it.live("stops within a single event chunk, closes the provider scope, and completes compaction once", () => {
  let closed = false
  const stream = Stream.scoped(Stream.unwrap(Effect.gen(function* () {
    yield* Effect.addFinalizer(() => Effect.sync(() => { closed = true }))
    return Stream.make(
      start, delta("accepted\n## Res"), delta("erved\nfabricated records"),
      delta("must never publish"), end,
      LLMEvent.providerError({ message: "must never handle" }),
      LLMEvent.stepFinish({ index: 0, reason: "length", usage: new Usage({ outputTokens: 999 }) }),
    )
  })))
  return Effect.gen(function* () {
    const out = yield* compactionStopCase({ stream, complete: Effect.sync(() => expect(closed).toBe(true)) })
    expect(out.result).toBe("continue")
    expect(out.deltas.join("")).toBe("accepted")
    expect(out.completed).toEqual(["accepted"])
    expect(out.text?.text).toBe("accepted" + records)
    expect(out.text?.time?.end).toBeDefined()
    expect(out.text?.metadata?.localStop).toEqual({ reason: "stop-sequence", sequenceIndex: 0, finalUsage: "unavailable" })
    expect(out.summary?.info).toMatchObject({ finish: "stop", time: { completed: expect.any(Number) } })
    if (out.summary?.info.role === "assistant") expect(out.summary.info.error).toBeUndefined()
    expect(out.summary?.parts.filter((part) => part.type === "step-finish")).toEqual([])
    expect(out.seen.filter((type) => type === SessionCompaction.Event.Compacted.type)).toHaveLength(1)
    expect(out.seen).not.toContain(Session.Event.Error.type)
    expect(out.seen).not.toContain("retry")
    expect(out.requests).toBe(1)
    expect(out.messages.flatMap((message) => message.parts).filter((part) => part.type === "text" && part.synthetic)).toHaveLength(1)
    expect(out.filtered.some((message) => message.info.id === out.original.id)).toBe(false)
  })
})

it.live("preserves usage already received and does not fabricate a second finish step", () =>
  Effect.gen(function* () {
    const out = yield* compactionStopCase({ stream: Stream.make(
      LLMEvent.stepFinish({ index: 0, reason: "stop", usage: new Usage({ inputTokens: 71, outputTokens: 13, totalTokens: 84 }) }),
      start, delta("accepted<begin-records>hidden"),
    ) })
    expect(out.summary?.info).toMatchObject({ tokens: { input: 71, output: 13, total: 84 } })
    expect(out.summary?.parts.filter((part) => part.type === "step-finish")).toHaveLength(1)
    expect(out.text?.metadata?.localStop).toMatchObject({ finalUsage: "unavailable" })
  }),
)

it.live("flushes an unmatched prefix at natural text-end and completes normally", () =>
  Effect.gen(function* () {
    const out = yield* compactionStopCase({ stream: Stream.make(
      start, delta("accepted\n## Reserve"), end,
      LLMEvent.stepFinish({ index: 0, reason: "stop", usage: new Usage({ inputTokens: 8, outputTokens: 3 }) }),
    ) })
    expect(out.deltas.join("")).toBe("accepted\n## Reserve")
    expect(out.completed).toEqual(["accepted\n## Reserve"])
    expect(out.text?.text).toBe("accepted\n## Reserve" + records)
    expect(out.text?.metadata).not.toHaveProperty("localStop")
    expect(out.summary?.parts.filter((part) => part.type === "step-finish")).toHaveLength(1)
    expect(out.result).toBe("continue")
  }),
)

for (const text of ["## Reserved\nfabricated", " \n<begin-records>fabricated", "   "]) {
  it.live(`rejects an empty accepted narrative ${JSON.stringify(text)} without hiding source history`, () =>
    Effect.gen(function* () {
      const out = yield* compactionStopCase({ stream: Stream.make(start, delta(text), end) })
      expect(out.result).toBe("stop")
      expect(out.summary?.info).toHaveProperty("error")
      expect(out.completed).toEqual([])
      expect(out.filtered.some((message) => message.info.id === out.original.id)).toBe(true)
      expect(out.seen).not.toContain(SessionCompaction.Event.Compacted.type)
      expect(out.seen).not.toContain("retry")
      expect(out.messages.flatMap((message) => message.parts).some((part) => part.type === "text" && part.synthetic)).toBe(false)
    }),
  )
}

it.live("fails compaction without retry when authoritative completion throws a retryable error after local stop", () =>
  Effect.gen(function* () {
    const out = yield* compactionStopCase({
      stream: Stream.make(start, delta("accepted<begin-records>hidden")),
      completeError: new APICallError({ message: "authoritative append failed", url: "http://127.0.0.1/append", requestBodyValues: {}, statusCode: 503, isRetryable: true }),
    })
    expect(out.result).toBe("stop")
    expect(out.completed).toEqual(["accepted"])
    expect(out.text?.text).toBe("accepted")
    expect(out.text?.metadata?.localStop).toMatchObject({ finalUsage: "unavailable" })
    expect(out.summary?.info).toHaveProperty("error")
    expect(out.filtered.some((message) => message.info.id === out.original.id)).toBe(true)
    expect(out.seen).not.toContain(SessionCompaction.Event.Compacted.type)
    expect(out.seen).not.toContain("retry")
    expect(out.requests).toBe(1)
  }),
)

it.live("leaves the no-policy delta publications byte-identical", () =>
  Effect.gen(function* () {
    const chunks = ["accepted\n## Res", "erved\nordinary text"]
    const out = yield* compactionStopCase({ sequences: [], stream: Stream.make(start, ...chunks.map(delta), end) })
    expect(out.deltas).toEqual(chunks)
    expect(out.completed).toEqual([chunks.join("")])
    expect(out.text?.text).toBe(chunks.join("") + records)
    expect(out.text?.metadata).not.toHaveProperty("localStop")
  }),
)
