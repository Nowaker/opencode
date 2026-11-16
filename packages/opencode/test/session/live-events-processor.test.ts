import { expect } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { LLMEvent } from "@opencode-ai/llm"
import { EventV2Bridge } from "@/event-v2-bridge"
import { LiveEvents } from "@/session/live-events"
import { PartID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { isRecord } from "@/util/record"
import { Feed, boot, config, it, snapshot } from "./live-events.fixture"

it.instance("first attachment includes completed reasoning, partial text and the entire pending tool prefix", () =>
  Effect.gen(function* () {
    const { session, chat, user, assistant, handle, input } = yield* boot
    const live = yield* LiveEvents.Service
    const feed = yield* Feed
    const events = yield* EventV2Bridge.Service
    const nativeRaw: unknown[] = []
    const off = yield* events.listen((event) => Effect.sync(() => {
      if (event.type === "message.part.delta" && isRecord(event.data) && event.data.field === "state.raw") nativeRaw.push(event.data)
    }))
    const run = yield* handle.process(input).pipe(Effect.forkChild)
    for (const event of [
      LLMEvent.reasoningStart({ id: "r" }), LLMEvent.reasoningDelta({ id: "r", text: "thought" }),
      LLMEvent.reasoningEnd({ id: "r" }), LLMEvent.textStart({ id: "t" }),
      LLMEvent.textDelta({ id: "t", text: "partial" }),
      LLMEvent.toolInputStart({ id: "call", name: "lookup" }),
      LLMEvent.toolInputDelta({ id: "call", name: "lookup", text: '{"query":"' }),
    ]) yield* feed.send(event)
    handle.message.cost = 999

    const attachment = yield* live.open({ sessionID: chat.id }, snapshot(chat.id))
    const reader = attachment.frames.getReader()
    const frame = (yield* Effect.promise(() => reader.read())).value
    if (frame?.type !== "vibeterm.stream.snapshot") throw new Error("expected snapshot")
    expect(frame.properties.status).toEqual({ type: "busy" })
    expect(frame.properties.messages.map((message) => message.info.id)).toEqual([user.id, assistant.id])
    expect(frame.properties.messages[1].info).toMatchObject({ cost: 0 })
    const parts = frame.properties.messages[1].parts
    const reasoning = parts.find((part) => part.type === "reasoning")
    expect(reasoning).toMatchObject({ text: "thought", time: { end: expect.any(Number) } })
    expect(parts.find((part) => part.type === "text")).toMatchObject({ text: "partial" })
    const pending = parts.find((part) => part.type === "tool")
    expect(pending).toMatchObject({ callID: "call", state: { status: "pending", raw: '{"query":"' } })
    const stored = (yield* session.messages({ sessionID: chat.id }))[2].parts.find((part) => part.type === "tool")
    expect(stored).toMatchObject({ state: { status: "pending", raw: "" } })

    yield* feed.send(LLMEvent.toolInputDelta({ id: "call", name: "lookup", text: 'x"}' }))
    expect((yield* Effect.promise(() => reader.read())).value).toMatchObject({ properties: {
      sequence: 1, event: { type: "message.part.delta", properties: {
        sessionID: chat.id, messageID: assistant.id, partID: pending?.id, callID: "call", field: "state.raw", delta: 'x"}',
      } },
    } })
    yield* feed.send(LLMEvent.toolCall({ id: "call", name: "lookup", input: { query: "x" }, providerExecuted: true }))
    expect((yield* Effect.promise(() => reader.read())).value).toMatchObject({ properties: {
      sequence: 2, event: { type: "message.part.updated", properties: { part: { metadata: { providerExecuted: true } } } },
    } })
    expect((yield* Effect.promise(() => reader.read())).value).toMatchObject({ properties: {
      sequence: 3, event: { type: "message.part.updated", properties: { part: { state: { status: "running" } } } },
    } })
    expect([...feed.sources].flatMap((source) => source()).filter((part) => part.type === "tool")).toEqual([])
    expect(nativeRaw).toEqual([])
    yield* off
    attachment.close()
    yield* feed.send(LLMEvent.toolResult({ id: "call", name: "lookup", result: { type: "json", value: {} } }))
    yield* feed.send(LLMEvent.textEnd({ id: "t" }))
    yield* feed.end
    yield* Fiber.join(run)
    const status = yield* SessionStatus.Service
    yield* status.set(chat.id, { type: "idle" })
    expect(feed.sources.size).toBe(0)
    const reopened = yield* live.open({ sessionID: chat.id }, snapshot(chat.id))
    const final = (yield* Effect.promise(() => reopened.frames.getReader().read())).value
    expect(final).toMatchObject({ properties: { status: { type: "idle" }, messages: [expect.anything(), { parts: expect.arrayContaining([
      expect.objectContaining({ id: reasoning?.id, type: "reasoning", text: "thought", time: reasoning?.time }),
      expect.objectContaining({ id: pending?.id, type: "tool", state: expect.objectContaining({ status: "completed" }) }),
      expect.objectContaining({ type: "text", text: "partial", time: expect.objectContaining({ end: expect.any(Number) }) }),
    ]) }] } })
    reopened.close()
  }), { config },
)

it.instance("attachment waits for an admitted durable publication before reading persisted parts", () =>
  Effect.gen(function* () {
    const { session, chat, assistant } = yield* boot
    const live = yield* LiveEvents.Service
    const events = yield* EventV2Bridge.Service
    const admitted = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const part: SessionV1.TextPart = {
      id: PartID.ascending(), sessionID: chat.id, messageID: assistant.id, type: "text", text: "committed",
    }
    const writer = yield* events.publish(SessionV1.Event.PartUpdated, { sessionID: chat.id, part, time: 1 }, {
      commit: () => Effect.gen(function* () {
        yield* Deferred.succeed(admitted, undefined)
        yield* Deferred.await(release)
      }),
    }).pipe(Effect.forkChild)
    yield* Deferred.await(admitted)
    const attach = yield* live.open({ sessionID: chat.id }, snapshot(chat.id))
      .pipe(Effect.forkChild({ startImmediately: true }))
    expect(attach.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(release, undefined)
    const attachment = yield* Fiber.join(attach)
    yield* Fiber.join(writer)
    expect((yield* Effect.promise(() => attachment.frames.getReader().read())).value).toMatchObject({
      properties: { messages: [expect.anything(), { parts: [part] }] },
    })
    attachment.close()
  }), { config },
)

it.instance("pending input retention ends at each parsed call and never writes deltas to native events or the database", () =>
  Effect.gen(function* () {
    const { chat, handle, input } = yield* boot
    const feed = yield* Feed
    const events = yield* EventV2Bridge.Service
    const database = yield* Database.Service
    const native: string[] = []
    const off = yield* events.listen((event) => Effect.sync(() => { native.push(event.type) }))
    const run = yield* handle.process(input).pipe(Effect.forkChild)
    for (let i = 0; i < 16; i++) {
      const id = `call-${i}`
      yield* feed.send(LLMEvent.toolInputStart({ id, name: "lookup" }))
      const before = yield* database.db.select().from(EventTable).where(eq(EventTable.aggregate_id, chat.id))
      const sequence = yield* database.db.select().from(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, chat.id))
      const seen = native.length
      yield* feed.send(LLMEvent.toolInputDelta({ id, name: "lookup", text: "x".repeat(32768) }))
      expect(yield* database.db.select().from(EventTable).where(eq(EventTable.aggregate_id, chat.id))).toEqual(before)
      expect(yield* database.db.select().from(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, chat.id))).toEqual(sequence)
      expect(native.length).toBe(seen)
      yield* feed.send(LLMEvent.toolCall({ id, name: "lookup", input: {}, providerExecuted: true }))
      expect([...feed.sources].flatMap((source) => source()).filter((part) => part.type === "tool")).toEqual([])
      yield* feed.send(LLMEvent.toolResult({ id, name: "lookup", result: { type: "json", value: {} } }))
    }
    yield* feed.end
    yield* Fiber.join(run)
    yield* off
    expect(feed.sources.size).toBe(0)
    expect(native.filter((type) => type === "message.part.delta")).toEqual([])
  }), { config },
)
