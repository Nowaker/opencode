import { expect } from "bun:test"
import { APICallError } from "ai"
import { LLMEvent, Usage } from "@opencode-ai/llm"
import { Effect, Layer, Stream } from "effect"
import { SessionCompaction } from "@/session/compaction"
import { compactionStopCase, records, sequences } from "./compaction-stop.fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

for (const policy of [sequences, []]) {
  for (const afterAppend of [false, true]) {
    it.live(`does not regenerate at natural text-end when a one-shot completion hook fails ${afterAppend ? "after consuming retention" : "before append"}, boundaries ${policy.length ? "enabled" : "disabled"}`, () =>
      Effect.gen(function* () {
        const error = new APICallError({
          message: "one-shot completion failure",
          url: "http://127.0.0.1/complete",
          requestBodyValues: {},
          statusCode: 503,
          responseHeaders: { "retry-after-ms": "1" },
          responseBody: "completion service unavailable",
          isRetryable: true,
        })
        let attempts = 0
        let snapshotAvailable = true
        let appends = 0
        const failOnce = Effect.sync(() => {
          attempts++
          if (attempts === 1) throw error
        })
        const out = yield* compactionStopCase({
          sequences: policy,
          stream: Stream.make(
            LLMEvent.textStart({ id: "text" }),
            LLMEvent.textDelta({ id: "text", text: "accepted narrative" }),
            LLMEvent.textEnd({ id: "text" }),
            LLMEvent.stepFinish({ index: 0, reason: "stop", usage: new Usage({ inputTokens: 8, outputTokens: 3 }) }),
          ),
          complete: afterAppend ? undefined : failOnce,
          append: (text) => {
            if (!snapshotAvailable) return text
            snapshotAvailable = false
            appends++
            return text + records
          },
          afterComplete: afterAppend ? failOnce : undefined,
        })

        expect(out.requests).toBe(1)
        expect(out.result).toBe("stop")
        expect(attempts).toBe(1)
        expect(out.completed).toEqual(["accepted narrative"])
        expect(appends).toBe(afterAppend ? 1 : 0)
        expect(snapshotAvailable).toBe(!afterAppend)
        expect(out.text?.text).toBe("accepted narrative")
        expect(out.summary?.info.role).toBe("assistant")
        if (out.summary?.info.role === "assistant") {
          expect(out.summary.info.error).toMatchObject({
            name: "APIError",
            data: {
              message: error.message,
              statusCode: 503,
              isRetryable: true,
              responseHeaders: error.responseHeaders,
              responseBody: error.responseBody,
            },
          })
          expect(out.summary.info.time.completed).toBeDefined()
        }
        expect(out.filtered.some((message) => message.info.id === out.original.id)).toBe(true)
        expect(out.seen).not.toContain(SessionCompaction.Event.Compacted.type)
        expect(out.seen).not.toContain("retry")
        expect(out.messages.flatMap((message) => message.parts).some((part) => part.type === "text" && part.synthetic)).toBe(false)
      }),
    )
  }
}
