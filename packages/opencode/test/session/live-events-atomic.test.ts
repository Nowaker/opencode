import { expect } from "bun:test"
import { APICallError } from "ai"
import { Deferred, Effect, Fiber } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import { LiveEvents } from "@/session/live-events"
import { SessionStatus } from "@/session/status"
import { MessageID } from "@/session/schema"
import { EventV2Bridge } from "@/event-v2-bridge"
import { isRecord } from "@/util/record"
import { Feed, boot, config, it, snapshot } from "./live-events.fixture"

it.instance("attachment between text mutation and native delta publication includes the prefix exactly once", () =>
  Effect.gen(function* () {
    const { chat, handle, input } = yield* boot
    const live = yield* LiveEvents.Service
    const feed = yield* Feed
    const run = yield* handle.process(input).pipe(Effect.forkChild)
    yield* feed.send(LLMEvent.textStart({ id: "t" }))
    const mutated = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    let guards = 0
    feed.beforeGuard = () => Effect.gen(function* () {
      if (++guards !== 2) return
      yield* Deferred.succeed(mutated, undefined)
      yield* Deferred.await(release)
    })
    const writer = yield* feed.send(LLMEvent.textDelta({ id: "t", text: "prefix" })).pipe(Effect.forkChild)
    yield* Deferred.await(mutated)
    const attach = yield* live.open({ sessionID: chat.id }, snapshot(chat.id)).pipe(Effect.forkChild({ startImmediately: true }))
    expect(attach.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(writer)
    feed.beforeGuard = undefined
    const attachment = yield* Fiber.join(attach)
    const reader = attachment.frames.getReader()
    expect((yield* Effect.promise(() => reader.read())).value).toMatchObject({ properties: {
      sequence: 0, messages: [expect.anything(), { parts: [expect.objectContaining({ type: "text", text: "prefix" })] }],
    } })
    yield* feed.send(LLMEvent.textDelta({ id: "t", text: "suffix" }))
    expect((yield* Effect.promise(() => reader.read())).value).toMatchObject({ properties: {
      sequence: 1, event: { type: "message.part.delta", properties: { field: "text", delta: "suffix" } },
    } })
    attachment.close()
    yield* feed.end
    yield* Fiber.join(run)
  }), { config },
)

it.instance("snapshot status waits for mutation plus notification, including paused status", () =>
  Effect.gen(function* () {
    const { chat } = yield* boot
    const live = yield* LiveEvents.Service
    const status = yield* SessionStatus.Service
    const feed = yield* Feed
    const publishing = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    let guards = 0
    feed.beforeGuard = () => Effect.gen(function* () {
      if (++guards !== 2) return
      yield* Deferred.succeed(publishing, undefined)
      yield* Deferred.await(release)
    })
    const writer = yield* status.set(chat.id, { type: "busy" }).pipe(Effect.forkChild)
    yield* Deferred.await(publishing)
    const attach = yield* live.open({ sessionID: chat.id }, snapshot(chat.id)).pipe(Effect.forkChild({ startImmediately: true }))
    expect(attach.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(writer)
    feed.beforeGuard = undefined
    const attachment = yield* Fiber.join(attach)
    expect((yield* Effect.promise(() => attachment.frames.getReader().read())).value).toMatchObject({
      properties: { status: { type: "busy" } },
    })
    attachment.close()
    yield* status.setPaused(chat.id, { at: 1, mode: "soft", state: "paused", source: { kind: "tool" }, reason: "test" })
    yield* status.set(chat.id, { type: "idle" })
    const idle = yield* live.open({ sessionID: chat.id }, snapshot(chat.id))
    expect((yield* Effect.promise(() => idle.frames.getReader().read())).value).toMatchObject({
      properties: { status: { type: "idle", paused: { at: 1, mode: "soft", state: "paused", reason: "test" } } },
    })
    idle.close()
  }), { config },
)

it.instance("aborting a processor frees pending tool input and unregisters its source", () =>
  Effect.gen(function* () {
    const { handle, input } = yield* boot
    const feed = yield* Feed
    const run = yield* handle.process(input).pipe(Effect.forkChild)
    yield* feed.send(LLMEvent.toolInputStart({ id: "pending", name: "lookup" }))
    yield* feed.send(LLMEvent.toolInputDelta({ id: "pending", name: "lookup", text: "prefix" }))
    expect([...feed.sources].flatMap((source) => source())).toEqual([
      expect.objectContaining({ state: expect.objectContaining({ raw: "prefix" }) }),
    ])
    yield* feed.send(LLMEvent.toolError({ id: "pending", name: "lookup", message: "failed" }))
    expect([...feed.sources].flatMap((source) => source())).toEqual([])
    yield* Fiber.interrupt(run)
    expect(feed.sources.size).toBe(0)
  }), { config },
)

it.instance("a queued user message does not hide the active assistant from a late snapshot", () =>
  Effect.gen(function* () {
    const { session, chat, user, assistant, handle, input } = yield* boot
    const live = yield* LiveEvents.Service
    const feed = yield* Feed
    const run = yield* handle.process(input).pipe(Effect.forkChild)
    yield* feed.send(LLMEvent.textStart({ id: "active" }))
    yield* feed.send(LLMEvent.textDelta({ id: "active", text: "still running" }))
    const queued = yield* session.updateMessage({ ...user, id: MessageID.ascending(), time: { created: 4 } })
    const attachment = yield* live.open({ sessionID: chat.id }, snapshot(chat.id))
    const reader = attachment.frames.getReader()
    const frame = (yield* Effect.promise(() => reader.read())).value
    yield* feed.send(LLMEvent.textDelta({ id: "active", text: " after queue" }))
    const continuation = (yield* Effect.promise(() => reader.read())).value
    attachment.close()
    yield* feed.end
    yield* Fiber.join(run)
    if (frame?.type !== "vibeterm.stream.snapshot") throw new Error("expected snapshot")
    expect(frame.properties.messages.map((message) => message.info.id)).toEqual([user.id, assistant.id, queued.id])
    expect(frame.properties.messages.flatMap((message) => message.parts)).toContainEqual(
      expect.objectContaining({ type: "text", text: "still running", messageID: assistant.id }),
    )
    expect(continuation).toMatchObject({
      properties: { sequence: 1, event: { properties: { messageID: assistant.id, delta: " after queue" } } },
    })
  }), { config },
)

it.instance("a late snapshot during terminal error cleanup retains the registered processor before its final update", () =>
  Effect.gen(function* () {
    const { session, chat, user, assistant, handle, input } = yield* boot
    const live = yield* LiveEvents.Service
    const status = yield* SessionStatus.Service
    const events = yield* EventV2Bridge.Service
    const feed = yield* Feed
    let failed = false
    let held = false
    let idle = false
    let completedAfterIdle = false
    const off = yield* events.listen((event) => Effect.sync(() => {
      if (!isRecord(event.data) || event.data.sessionID !== chat.id) return
      if (event.type === "session.error") failed = true
      if (event.type === "session.status" && isRecord(event.data.status) && event.data.status.type === "idle") idle = true
      if (event.type === "message.updated" && isRecord(event.data.info) && isRecord(event.data.info.time) &&
        typeof event.data.info.time.completed === "number") completedAfterIdle = idle
    }))
    const ready = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const run = yield* handle.process(input).pipe(Effect.forkChild)
    yield* feed.send(LLMEvent.textStart({ id: "active" }))
    yield* feed.send(LLMEvent.textDelta({ id: "active", text: "error prefix" }))
    const queued = yield* session.updateMessage({ ...user, id: MessageID.ascending(), time: { created: 4 } })
    feed.beforeGuard = () => Effect.gen(function* () {
      if (!failed || held) return
      const current = yield* status.get(chat.id)
      switch (current.type) {
        case "busy": case "retry": return
        case "idle": break
        default: throw new Error(current satisfies never)
      }
      held = true
      yield* Deferred.succeed(ready, undefined)
      yield* Deferred.await(release)
    })
    const failure = yield* feed.fail(new APICallError({ message: "terminal failure", url: "http://localhost/test",
      requestBodyValues: {}, statusCode: 400, isRetryable: false })).pipe(Effect.forkChild)
    yield* Deferred.await(ready)
    const attachment = yield* live.open({ sessionID: chat.id }, snapshot(chat.id))
    const frame = (yield* Effect.promise(() => attachment.frames.getReader().read())).value
    attachment.close()
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(failure)
    yield* Fiber.join(run)
    feed.beforeGuard = undefined
    yield* feed.end
    yield* off
    if (frame?.type !== "vibeterm.stream.snapshot") throw new Error("expected snapshot")
    expect(frame.properties.status.type).toBe("idle")
    expect(frame.properties.messages.map((message) => message.info.id)).toEqual([user.id, assistant.id, queued.id])
    expect(frame.properties.messages.flatMap((message) => message.parts)).toContainEqual(
      expect.objectContaining({ type: "text", text: "error prefix", messageID: assistant.id }),
    )
    expect(completedAfterIdle).toBe(true)
  }), { config },
)
