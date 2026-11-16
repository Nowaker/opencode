import { expect } from "bun:test"
import { APICallError } from "ai"
import { Effect, Fiber } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { EventSequenceTable } from "@opencode-ai/core/event/sql"
import { LLMEvent } from "@opencode-ai/llm"
import { EventV2Bridge } from "@/event-v2-bridge"
import { LiveEvents } from "@/session/live-events"
import { MessageID, PartID } from "@/session/schema"
import { isRecord } from "@/util/record"
import { Feed, boot, config, it, snapshot } from "./live-events.fixture"

const retry = () => new APICallError({
  message: "provider overloaded",
  url: "http://localhost/test",
  requestBodyValues: {},
  statusCode: 503,
  isRetryable: true,
  responseHeaders: { "retry-after-ms": "0" },
})

it.instance("a first late attachment retains unfinished text and reasoning across a provider retry", () =>
  Effect.gen(function* () {
    const { chat, session, handle, input } = yield* boot
    const live = yield* LiveEvents.Service
    const feed = yield* Feed
    const events = yield* EventV2Bridge.Service
    const database = yield* Database.Service
    const native: string[] = []
    const off = yield* events.listen((event) => Effect.sync(() => {
      if (isRecord(event.data) && event.data.sessionID === chat.id) native.push(event.type)
    }))
    const run = yield* handle.process(input).pipe(Effect.forkChild)
    yield* feed.send(LLMEvent.textStart({ id: "first-text" }))
    yield* feed.send(LLMEvent.textDelta({ id: "first-text", text: "abandoned text" }))
    yield* feed.send(LLMEvent.reasoningStart({ id: "first-reasoning" }))
    yield* feed.send(LLMEvent.reasoningDelta({ id: "first-reasoning", text: "abandoned reasoning" }))
    const before = (yield* session.messages({ sessionID: chat.id }))[2].parts
    const sequence = yield* database.db.select().from(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, chat.id))
    const mark = native.length

    yield* feed.fail(retry())
    yield* feed.send(LLMEvent.textStart({ id: "second-text" }))
    const after = (yield* session.messages({ sessionID: chat.id }))[2].parts
    expect(after.filter((part) => before.some((previous) => previous.id === part.id))).toEqual(before)
    expect(native.slice(mark)).toEqual(["session.status", "session.status", "message.part.updated"])
    expect(yield* database.db.select().from(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, chat.id)))
      .toEqual(sequence.map((row) => ({ ...row, seq: row.seq + 1 })))

    const attachment = yield* live.open({ sessionID: chat.id }, snapshot(chat.id))
    const reader = attachment.frames.getReader()
    const frame = (yield* Effect.promise(() => reader.read())).value
    if (frame?.type !== "vibeterm.stream.snapshot") throw new Error("expected snapshot")
    const parts = frame.properties.messages.flatMap((message) => message.parts)
    expect(parts.find((part) => part.id === before[0].id)).toMatchObject({ type: "text", text: "abandoned text" })
    expect(parts.find((part) => part.id === before[1].id)).toMatchObject({ type: "reasoning", text: "abandoned reasoning" })
    yield* feed.send(LLMEvent.textDelta({ id: "second-text", text: "second attempt" }))
    expect((yield* Effect.promise(() => reader.read())).value).toMatchObject({ properties: {
      sequence: 1, event: { type: "message.part.delta", properties: { delta: "second attempt" } },
    } })
    attachment.close()
    yield* feed.end
    yield* Fiber.join(run)
    yield* off
  }), { config },
)

for (const terminal of ["finish", "abort"] as const) {
it.instance(`retained source references release every abandoned prefix after repeated retries and ${terminal}`, () =>
  Effect.gen(function* () {
    const { handle, input } = yield* boot
    const feed = yield* Feed
    const source = [...feed.sources][0]
    if (!source) throw new Error("processor source missing")
    const run = yield* handle.process(input).pipe(Effect.forkChild)
    for (let attempt = 0; attempt < 3; attempt++) {
      yield* feed.send(LLMEvent.textStart({ id: `text-${attempt}` }))
      yield* feed.send(LLMEvent.textDelta({ id: `text-${attempt}`, text: `text-${attempt}` }))
      yield* feed.send(LLMEvent.reasoningStart({ id: `reasoning-${attempt}` }))
      yield* feed.send(LLMEvent.reasoningDelta({ id: `reasoning-${attempt}`, text: `reasoning-${attempt}` }))
      yield* feed.fail(retry())
    }
    yield* feed.send(LLMEvent.textStart({ id: "final" }))
    expect(source().filter((part) => part.type === "text" || part.type === "reasoning").map((part) => part.text)).toEqual([
      "text-0", "reasoning-0", "text-1", "reasoning-1", "text-2", "reasoning-2", "",
    ])
    yield* feed.send(LLMEvent.textDelta({ id: "final", text: "finished" }))
    switch (terminal) {
      case "finish":
        yield* feed.end
        yield* Fiber.join(run)
        break
      case "abort":
        yield* Fiber.interrupt(run)
        break
      default:
        throw new Error(terminal satisfies never)
    }
    expect(source()).toEqual([])
  }), { config },
)
}

for (const type of ["message.part.updated", "message.part.removed", "message.removed", "session.deleted"] as const) {
it.instance(`authoritative ${type} retires abandoned references with zero live subscribers`, () =>
  Effect.gen(function* () {
    const { chat, session, assistant, handle, input } = yield* boot
    const live = yield* LiveEvents.Service
    const feed = yield* Feed
    const source = [...feed.sources][0]
    if (!source) throw new Error("processor source missing")
    const run = yield* handle.process(input).pipe(Effect.forkChild)
    yield* feed.send(LLMEvent.textStart({ id: "first" }))
    yield* feed.send(LLMEvent.textDelta({ id: "first", text: "abandoned text" }))
    yield* feed.send(LLMEvent.reasoningStart({ id: "reason" }))
    yield* feed.send(LLMEvent.reasoningDelta({ id: "reason", text: "abandoned reasoning" }))
    const parts = (yield* session.messages({ sessionID: chat.id }))[2].parts
    const prefix = parts.find((part) => part.type === "text")
    if (!prefix) throw new Error("text part missing")
    yield* feed.fail(retry())
    yield* feed.send(LLMEvent.textStart({ id: "second" }))
    expect(source().filter((part) => "text" in part && part.text)).toHaveLength(2)

    switch (type) {
      case "message.part.updated":
        live.capture({ type, data: { sessionID: chat.id, part: { ...prefix, id: PartID.ascending() } } })
        expect(source().filter((part) => "text" in part && part.text)).toHaveLength(2)
        yield* session.updatePart({ ...prefix, text: "authoritative" })
        break
      case "message.part.removed":
        live.capture({ type, data: { sessionID: chat.id, messageID: assistant.id, partID: PartID.ascending() } })
        expect(source().filter((part) => "text" in part && part.text)).toHaveLength(2)
        yield* session.removePart({ sessionID: chat.id, messageID: assistant.id, partID: prefix.id })
        break
      case "message.removed":
        live.capture({ type, data: { sessionID: chat.id, messageID: MessageID.ascending() } })
        expect(source().filter((part) => "text" in part && part.text)).toHaveLength(2)
        live.capture({ type, data: { sessionID: chat.id, messageID: assistant.id } })
        break
      case "session.deleted":
        live.capture({ type, data: { sessionID: chat.id } })
        break
      default:
        throw new Error(type satisfies never)
    }
    expect(source().filter((part) => "text" in part && part.text).map((part) => "text" in part && part.text))
      .toEqual(type.startsWith("message.part.") ? ["abandoned reasoning"] : [])
    yield* feed.end
    yield* Fiber.join(run)
    expect(source()).toEqual([])
  }), { config },
)
}
