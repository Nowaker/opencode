import { expect } from "bun:test"
import { getEventListeners } from "node:events"
import { Effect, Deferred, Fiber } from "effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { LiveEvents } from "@/session/live-events"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { testEffect } from "../lib/effect"

const it = testEffect(LiveEvents.layer)
const sessionID = SessionID.make("ses_live")
const messageID = MessageID.make("msg_live")
const part: SessionV1.TextPart = {
  id: PartID.make("prt_live"), messageID, sessionID,
  type: "text", text: "", time: { start: 1 },
}
const info: SessionV1.User = {
  id: messageID, sessionID, role: "user", agent: "build",
  time: { created: 1 }, model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
}
const read = (messages: SessionV1.WithParts[] = []) => Effect.succeed({ messages, status: { type: "idle" as const } })

it.live("attachment drains an admitted mutation and reuses its nested publication lease", () =>
  Effect.gen(function* () {
    const live = yield* LiveEvents.Service
    const mutated = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const text = { ...part }
    yield* live.register(sessionID, () => [structuredClone(text)])
    const writer = yield* live.guard(sessionID, Effect.gen(function* () {
      text.text = "before"
      yield* Deferred.succeed(mutated, undefined)
      yield* Deferred.await(release)
      yield* live.guard(sessionID, Effect.sync(() => live.capture({
        type: "message.part.delta", data: { sessionID, messageID, partID: part.id, field: "text", delta: "before" },
      })))
    })).pipe(Effect.forkChild)
    yield* Deferred.await(mutated)
    const attach = yield* live.open({ sessionID }, read([{ info, parts: [part] }])).pipe(Effect.forkChild({ startImmediately: true }))
    yield* Deferred.succeed(release, undefined)
    const attachment = yield* Fiber.join(attach)
    yield* Fiber.join(writer)
    const reader = attachment.frames.getReader()
    const snapshot = yield* Effect.promise(() => reader.read())
    expect(snapshot.value).toMatchObject({
      type: "vibeterm.stream.snapshot", properties: { sequence: 0, messages: [{ parts: [{ text: "before" }] }] },
    })
    yield* live.guard(sessionID, Effect.sync(() => live.capture({
      type: "message.part.delta", data: { sessionID, messageID, partID: part.id, field: "text", delta: "after" },
    })))
    expect((yield* Effect.promise(() => reader.read())).value).toMatchObject({
      properties: { sequence: 1, event: { properties: { delta: "after" } } },
    })
    attachment.close()
  }),
)

it.live("subscribers have independent epochs, payloads and close lifetimes", () =>
  Effect.gen(function* () {
    const live = yield* LiveEvents.Service
    const first = yield* live.open({ sessionID }, read([{ info, parts: [] }]))
    const second = yield* live.open({ sessionID }, read([{ info, parts: [] }]))
    const one = first.frames.getReader()
    const two = second.frames.getReader()
    const a = (yield* Effect.promise(() => one.read())).value
    const b = (yield* Effect.promise(() => two.read())).value
    expect(a?.properties.epoch).not.toBe(b?.properties.epoch)
    live.capture({ type: "session.status", data: { sessionID, status: { type: "busy" } } })
    const event = (yield* Effect.promise(() => one.read())).value
    if (event?.type !== "vibeterm.stream.event") throw new Error("expected event")
    event.properties.event.properties.status = { type: "idle" }
    expect((yield* Effect.promise(() => two.read())).value).toMatchObject({
      properties: { sequence: 1, event: { properties: { status: { type: "busy" } } } },
    })
    first.close()
    first.close()
    expect(yield* Effect.promise(() => one.read())).toEqual({ done: true, value: undefined })
    live.capture({ type: "session.status", data: { sessionID, status: { type: "idle" } } })
    expect((yield* Effect.promise(() => two.read())).value).toMatchObject({
      properties: { sequence: 2, event: { properties: { status: { type: "idle" } } } },
    })
    second.close()
  }),
)

it.live("cancellation during snapshot admission releases the fence and abort listener", () =>
  Effect.gen(function* () {
    const live = yield* LiveEvents.Service
    const started = yield* Deferred.make<void>()
    const controller = new AbortController()
    const attachment = yield* live.open({ sessionID, signal: controller.signal }, Effect.gen(function* () {
      yield* Deferred.succeed(started, undefined)
      return yield* Effect.never
    })).pipe(Effect.exit, Effect.forkChild)
    yield* Deferred.await(started)
    controller.abort()
    expect((yield* Fiber.join(attachment))._tag).toBe("Failure")
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0)
    const next = yield* live.open({ sessionID }, read())
    next.close()
  }),
)

it.live("consumer cancellation removes its signal listener", () =>
  Effect.gen(function* () {
    const live = yield* LiveEvents.Service
    const controller = new AbortController()
    const attachment = yield* live.open({ sessionID, signal: controller.signal }, read())
    yield* Effect.promise(() => attachment.frames.getReader().cancel())
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0)
    attachment.close()
  }),
)

it.live("publications remain concurrent while snapshot admission blocks new publications", () =>
  Effect.gen(function* () {
    const live = yield* LiveEvents.Service
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const first = yield* live.guard(sessionID, Effect.gen(function* () {
      yield* Deferred.succeed(entered, undefined)
      yield* Deferred.await(release)
    })).pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    yield* live.guard(sessionID, Effect.void)
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(first)
    const reading = yield* Deferred.make<void>()
    const finish = yield* Deferred.make<void>()
    const attach = yield* live.open({ sessionID }, Effect.gen(function* () {
      yield* Deferred.succeed(reading, undefined)
      yield* Deferred.await(finish)
      return { messages: [], status: { type: "idle" as const } }
    })).pipe(Effect.forkChild)
    yield* Deferred.await(reading)
    const writer = yield* live.guard(sessionID, Effect.sync(() => live.capture({
      type: "session.status", data: { sessionID, status: { type: "busy" } },
    }))).pipe(Effect.forkChild({ startImmediately: true }))
    expect(writer.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(finish, undefined)
    const attachment = yield* Fiber.join(attach)
    yield* Fiber.join(writer)
    const reader = attachment.frames.getReader()
    expect((yield* Effect.promise(() => reader.read())).value?.type).toBe("vibeterm.stream.snapshot")
    expect((yield* Effect.promise(() => reader.read())).value).toMatchObject({ properties: { sequence: 1 } })
    attachment.close()
  }),
)

it.live("overflow errors the consumer rather than dropping events", () =>
  Effect.gen(function* () {
    const live = yield* LiveEvents.Service
    const attachment = yield* live.open({ sessionID }, read())
    for (let i = 0; i < 300; i++) {
      live.capture({ type: "session.status", data: { sessionID, status: { type: "busy" } } })
    }
    yield* Effect.promise(async () => {
      await expect(attachment.frames.getReader().read()).rejects.toThrow("overflow")
    })
    attachment.close()
  }),
)

it.live("unused capture does not inspect or clone payloads or read sources", () =>
  Effect.gen(function* () {
    const live = yield* LiveEvents.Service
    let reads = 0
    yield* live.register(sessionID, () => { reads++; return [] })
    live.capture({ type: "session.status", data: { sessionID, get status() { throw new Error("cloned while off") } } })
    yield* live.guard(sessionID, Effect.void)
    expect(reads).toBe(0)
  }),
)

it.live("a delayed part from a message before the snapshot cut is omitted without consuming a sequence", () =>
  Effect.gen(function* () {
    const live = yield* LiveEvents.Service
    const older = { ...info, id: MessageID.make("msg_older"), time: { created: 0 } }
    const attachment = yield* live.open({ sessionID }, read([{ info: older, parts: [] }, { info, parts: [] }]))
    const reader = attachment.frames.getReader()
    yield* Effect.promise(() => reader.read())
    live.capture({ type: "message.part.updated", data: {
      sessionID, part: { ...part, messageID: older.id, text: "delayed snapshot patch" }, time: 1,
    } })
    live.capture({ type: "session.status", data: { sessionID, status: { type: "busy" } } })
    const next = (yield* Effect.promise(() => reader.read())).value
    attachment.close()
    expect(next).toMatchObject({ properties: { sequence: 1, event: { type: "session.status" } } })
  }),
)

it.live("source invalidation receives authoritative events with no live subscriber", () =>
  Effect.gen(function* () {
    const live = yield* LiveEvents.Service
    const observed: string[] = []
    yield* live.register(sessionID, () => [], (event) => { observed.push(event.type) })
    live.capture({ type: "message.part.updated", data: { sessionID, part } })
    expect(observed).toEqual(["message.part.updated"])
  }),
)
