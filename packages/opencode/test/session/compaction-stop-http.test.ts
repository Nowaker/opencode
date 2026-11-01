import { expect } from "bun:test"
import { Deferred, Effect, Layer, Logger } from "effect"
import { SessionCompaction } from "@/session/compaction"
import { Session } from "@/session/session"
import { isRecord } from "@/util/record"
import { compactionStopCase, records } from "./compaction-stop.fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

for (const native of [false, true]) {
  it.live(`cancels real HTTP generation before completion on the ${native ? "native" : "AI SDK"} runtime`, () =>
    Effect.gen(function* () {
      const aborted = yield* Deferred.make<void>()
      const canceled = yield* Deferred.make<void>()
      let requests = 0
      let bytes = 0
      let body: unknown
      const runtimes: string[] = []
      const stops: unknown[] = []
      const capture = Logger.layer([Logger.make((options) => {
        const message = options.message
        if (!Array.isArray(message) || !isRecord(message[1])) return
        if (message[0] === "llm runtime selected" && typeof message[1]["llm.runtime"] === "string") {
          runtimes.push(message[1]["llm.runtime"])
        }
        if (message[0] === "local stream stop") stops.push(message[1])
      })])
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          if (request.method !== "POST") return new Response("not found", { status: 404 })
          requests++
          body = await request.json()
          request.signal.addEventListener("abort", () => Deferred.doneUnsafe(aborted, Effect.void), { once: true })
          const payload = [
            { delta: { role: "assistant" } },
            { delta: { content: "accepted\n## Res" } },
            { delta: { content: "erved\nfabricated records" } },
            { delta: { content: "must never publish" } },
          ].map((choice) => `data: ${JSON.stringify({
            id: "chatcmpl-local-stop",
            object: "chat.completion.chunk",
            model: "test-model",
            choices: [{ index: 0, ...choice }],
          })}\n\n`).join("")
          return new Response(new ReadableStream<Uint8Array>({
            start(controller) {
              const chunk = new TextEncoder().encode(payload)
              bytes += chunk.byteLength
              controller.enqueue(chunk)
            },
            cancel() { Deferred.doneUnsafe(canceled, Effect.void) },
          }), { headers: { "content-type": "text/event-stream" } })
        },
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => server.stop(true)))
      let cancellationObservedInHook = false
      const out = yield* compactionStopCase({
        native,
        complete: Effect.gen(function* () {
          yield* Deferred.await(aborted).pipe(Effect.timeout("3 seconds"))
          yield* Deferred.await(canceled).pipe(Effect.timeout("3 seconds"))
          cancellationObservedInHook = true
        }),
        config: {
          enabled_providers: ["opencode-stop-test"],
          provider: {
            "opencode-stop-test": {
              name: "Test",
              npm: "@ai-sdk/openai-compatible",
              options: { apiKey: "local-test-only", baseURL: `http://127.0.0.1:${server.port}/v1` },
              models: { "test-model": { name: "Test Model", limit: { context: 100_000, output: 10_000 } } },
            },
          },
        },
      }).pipe(Effect.provide(capture), Effect.timeout("15 seconds"))

      expect(runtimes).toEqual([native ? "native" : "ai-sdk"])
      expect(stops).toHaveLength(1)
      expect(stops[0]).toMatchObject({ reason: "stop-sequence", sequenceIndex: 0, finalUsage: "unavailable" })
      expect(requests).toBe(1)
      expect(out.deltas.join("")).toBe("accepted")
      if (out.summary?.info.role === "assistant") expect(out.summary.info.error).toBeUndefined()
      expect(cancellationObservedInHook).toBe(true)
      expect(requests).toBe(1)
      expect(bytes).toBeGreaterThan(0)
      expect(out.result).toBe("continue")
      expect(out.deltas.join("")).toBe("accepted")
      expect(out.completed).toEqual(["accepted"])
      expect(out.text?.text).toBe("accepted" + records)
      expect(out.text?.metadata?.localStop).toEqual({ reason: "stop-sequence", sequenceIndex: 0, finalUsage: "unavailable" })
      expect(out.summary?.info).toMatchObject({ finish: "stop", time: { completed: expect.any(Number) } })
      expect(out.summary?.parts.filter((part) => part.type === "step-finish")).toEqual([])
      expect(out.seen.filter((type) => type === SessionCompaction.Event.Compacted.type)).toHaveLength(1)
      expect(out.seen).not.toContain(Session.Event.Error.type)
      expect(out.seen).not.toContain("retry")
      expect(isRecord(body) && body.stop).toBeUndefined()
      expect(isRecord(body) && body.stopSequences).toBeUndefined()
    }),
  )
}
