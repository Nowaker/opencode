import { expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionMessage } from "@opencode/core/session/message"
import { Money } from "@opencode/schema/money"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

const fixture = Effect.gen(function* () {
  const plugins = yield* Plugin.Service
  const sessions = yield* Session.Service
  const bus = yield* Bus.Service
  const ctx = yield* PluginHost.make(plugins, "test.messages")
  const parent = yield* ctx.session.create({ title: "Durable todo history" })
  const write = Effect.fn(function* (todos: readonly { content: string; status: string }[] | undefined) {
    const assistantMessageID = SessionMessage.ID.create()
    const call = { sessionID: parent.id, assistantMessageID, id: `call_${assistantMessageID}` }
    yield* bus.publish(SessionEvent.Step.Started, {
      sessionID: parent.id,
      assistantMessageID,
      agent: Agent.ID.make("build"),
      model: Model.Ref.parse("test/model"),
      started: 0,
    })
    yield* bus.publish(SessionEvent.Tool.Input.Started, { ...call, name: "todowrite" })
    yield* bus.publish(SessionEvent.Tool.Called, { ...call, input: {}, executed: false })
    if (todos === undefined)
      yield* bus.publish(SessionEvent.Tool.Failed, {
        ...call,
        error: { type: "unknown", message: "failed" },
        executed: false,
      })
    if (todos !== undefined)
      yield* bus.publish(SessionEvent.Tool.Success, {
        ...call,
        content: [{ type: "text", text: "Todos saved" }],
        metadata: { todos: todos.map((todo) => ({ ...todo })) },
        executed: false,
      })
    yield* bus.publish(SessionEvent.Step.Ended, {
      sessionID: parent.id,
      assistantMessageID,
      finish: "stop",
      cost: Money.USD.make(0),
      tokens,
    })
    return assistantMessageID
  })
  const initial = yield* write([{ content: "Keep durable todo", status: "pending" }])
  const cleared = yield* write([])
  yield* bus.publish(SessionEvent.Compaction.Started, { sessionID: parent.id, reason: "manual" })
  yield* bus.publish(SessionEvent.Compaction.Ended, {
    sessionID: parent.id,
    reason: "manual",
    text: "Compacted history",
  })
  const failed = yield* write(undefined)
  return { ctx, sessions, sessionID: parent.id, initial, cleared, failed }
})

it.live("Effect plugins page durable assistant results beyond the compacted context", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const before = yield* f.sessions.get(f.sessionID)
    expect(f.ctx.app.capabilities?.sessionMessages).toBe(true)
    const context = yield* f.ctx.session.context({ sessionID: f.sessionID })
    expect(context.map((message) => message.id)).not.toContain(f.initial)
    expect(context.map((message) => message.id)).not.toContain(f.cleared)
    expect((yield* f.ctx.session.messages({ sessionID: f.sessionID })).data.map((message) => message.type)).toEqual([
      "assistant",
      "compaction",
      "assistant",
      "assistant",
    ])

    const input = { sessionID: f.sessionID, type: "assistant", limit: 1 } as const
    const newest = yield* f.ctx.session.messages({ ...input, order: "desc" })
    expect(newest.data.map((message) => message.id)).toEqual([f.failed])
    const cleared = yield* f.ctx.session.messages({ ...input, cursor: newest.cursor.next })
    expect(cleared.data).toMatchObject([
      { id: f.cleared, content: [{ state: { status: "completed", metadata: { todos: [] } } }] },
    ])
    const older = yield* f.ctx.session.messages({ ...input, cursor: cleared.cursor.next })
    expect(older.data).toMatchObject([
      {
        id: f.initial,
        content: [{ state: { metadata: { todos: [{ content: "Keep durable todo", status: "pending" }] } } }],
      },
    ])
    expect(yield* f.ctx.session.messages({ ...input, cursor: older.cursor.previous })).toEqual(cleared)
    expect((yield* f.ctx.session.messages({ ...input, cursor: older.cursor.next })).data).toEqual([])
    expect(yield* f.ctx.session.messages({ ...input, cursor: "invalid" }).pipe(Effect.flip)).toMatchObject({
      _tag: "Session.MessagesCursorError",
    })
    expect(
      yield* f.ctx.session.messages({ ...input, cursor: newest.cursor.next, order: "asc" }).pipe(Effect.flip),
    ).toMatchObject({ _tag: "Session.MessagesCursorError" })
    expect(yield* f.sessions.get(f.sessionID)).toEqual(before)
    expect(yield* f.sessions.inbox(f.sessionID)).toEqual([])
  }),
)

it.live("Promise plugins retain message paging and reject invalid cursor or missing session", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    yield* PluginPromise.fromPromise({
      id: "test.messages.promise",
      async setup(ctx) {
        expect(ctx.app.capabilities?.sessionMessages).toBe(true)
        const first = await ctx.session.messages({ sessionID: f.sessionID, type: "assistant", order: "asc", limit: 1 })
        expect(first.data).toMatchObject([
          { id: f.initial, content: [{ state: { metadata: { todos: [{ content: "Keep durable todo" }] } } }] },
        ])
        const second = await ctx.session.messages({
          sessionID: f.sessionID,
          type: "assistant",
          cursor: first.cursor.next ?? undefined,
          limit: 1,
        })
        expect(second.data).toMatchObject([{ id: f.cleared, content: [{ state: { metadata: { todos: [] } } }] }])
        await expect(ctx.session.messages({ sessionID: f.sessionID, cursor: "invalid" })).rejects.toThrow(
          "Invalid cursor",
        )
        await expect(ctx.session.messages({ sessionID: f.sessionID, limit: 0 })).rejects.toThrow()
        await expect(ctx.session.messages({ sessionID: Session.ID.create() })).rejects.toThrow()
      },
    }).effect(f.ctx)
  }),
)
