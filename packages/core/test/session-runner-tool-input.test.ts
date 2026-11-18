import { expect } from "bun:test"
import { LLMEvent } from "@opencode/ai/effect"
import { createLLMEventPublisher } from "@opencode/core/session/runner/publish-llm-event"
import { SessionEvent } from "@opencode/schema/session-event"
import { Effect, Schema } from "effect"
import { TestClock } from "effect/testing"
import { toolInputFixture, toolInputLayer } from "./fixture/tool-input"
import { testEffect } from "./lib/effect"

const it = testEffect(toolInputLayer)

it.effect("publishes batched tool input deltas before the full raw ended text", () =>
  Effect.gen(function* () {
    const f = yield* toolInputFixture
    const publisher = createLLMEventPublisher(f.bus, f.input)
    yield* Effect.forEach(
      [
        LLMEvent.toolInputStart({ id: "call", name: "read" }),
        LLMEvent.toolInputDelta({ id: "call", name: "read", text: '{"path":' }),
        LLMEvent.toolInputDelta({ id: "call", name: "read", text: '"file.txt"}' }),
      ],
      publisher.publish,
      { discard: true },
    )
    expect(f.published.filter(Schema.is(SessionEvent.Tool.Input.Delta))).toEqual([])
    yield* TestClock.adjust("99 millis")
    expect(f.published.filter(Schema.is(SessionEvent.Tool.Input.Delta))).toEqual([])
    yield* TestClock.adjust("1 millis")
    const identity = { sessionID: f.input.sessionID, assistantMessageID: f.input.assistantMessageID, id: "call" }
    expect(f.published.filter(Schema.is(SessionEvent.Tool.Input.Delta)).map((event) => event.data)).toEqual([
      { ...identity, delta: '{"path":"file.txt"}' },
    ])

    yield* publisher.publish(LLMEvent.toolInputDelta({ id: "call", name: "read", text: "" }))
    yield* publisher.publish(LLMEvent.toolInputEnd({ id: "call", name: "read" }))
    expect(f.events().slice(-2)).toEqual([
      { type: "session.tool.input.delta", data: { ...identity, delta: '{"path":"file.txt"}' } },
      { type: "session.tool.input.ended", data: { ...identity, text: '{"path":"file.txt"}' } },
    ])
    expect(f.published.find(Schema.is(SessionEvent.Tool.Input.Delta))).not.toHaveProperty("durable")
    const settled = f.events()
    yield* TestClock.adjust("1 second")
    expect(f.events()).toEqual(settled)
  }),
)

it.effect("publishes trailing tool input while paused and flushes the final batch before Ended", () =>
  Effect.gen(function* () {
    const f = yield* toolInputFixture
    const publisher = createLLMEventPublisher(f.bus, f.input)
    const identity = { sessionID: f.input.sessionID, assistantMessageID: f.input.assistantMessageID, id: "call" }
    yield* publisher.publish(LLMEvent.toolInputStart({ id: "call", name: "read" }))
    yield* publisher.publish(LLMEvent.toolInputDelta({ id: "call", name: "read", text: '{"path":' }))
    yield* TestClock.adjust("100 millis")
    expect(f.published.filter(Schema.is(SessionEvent.Tool.Input.Delta)).map((event) => event.data)).toEqual([
      { ...identity, delta: '{"path":' },
    ])
    expect(f.published.filter(Schema.is(SessionEvent.Tool.Input.Ended))).toEqual([])

    yield* publisher.publish(LLMEvent.toolInputDelta({ id: "call", name: "read", text: '"file' }))
    yield* publisher.publish(LLMEvent.toolInputDelta({ id: "call", name: "read", text: '.txt"}' }))
    yield* publisher.publish(LLMEvent.toolInputEnd({ id: "call", name: "read" }))
    expect(f.events().slice(-2)).toEqual([
      { type: "session.tool.input.delta", data: { ...identity, delta: '"file.txt"}' } },
      { type: "session.tool.input.ended", data: { ...identity, text: '{"path":"file.txt"}' } },
    ])
    expect(f.published.filter(Schema.is(SessionEvent.Tool.Input.Delta)).map((event) => event.data)).toEqual([
      { ...identity, delta: '{"path":' },
      { ...identity, delta: '"file.txt"}' },
    ])
    const settled = f.events()
    yield* TestClock.adjust("1 second")
    expect(f.events()).toEqual(settled)
  }),
)

it.effect("flushes tool input before text, reasoning, and another tool block without mixing tool IDs", () =>
  Effect.gen(function* () {
    const f = yield* toolInputFixture
    const publisher = createLLMEventPublisher(f.bus, f.input)
    const identity = { sessionID: f.input.sessionID, assistantMessageID: f.input.assistantMessageID }
    yield* Effect.forEach(
      [
        LLMEvent.toolInputStart({ id: "first", name: "read" }),
        LLMEvent.toolInputDelta({ id: "first", name: "read", text: '{"path":' }),
        LLMEvent.textStart({ id: "text" }),
        LLMEvent.toolInputDelta({ id: "first", name: "read", text: '"one' }),
        LLMEvent.reasoningStart({ id: "reasoning" }),
        LLMEvent.toolInputDelta({ id: "first", name: "read", text: '.txt"}' }),
        LLMEvent.toolInputStart({ id: "second", name: "edit" }),
      ],
      publisher.publish,
      { discard: true },
    )
    expect(f.events().slice(1)).toEqual([
      { type: "session.tool.input.started", data: { ...identity, id: "first", name: "read" } },
      { type: "session.tool.input.delta", data: { ...identity, id: "first", delta: '{"path":' } },
      { type: "session.text.started", data: { ...identity, ordinal: 0 } },
      { type: "session.tool.input.delta", data: { ...identity, id: "first", delta: '"one' } },
      { type: "session.reasoning.started", data: { ...identity, ordinal: 0, native: undefined } },
      { type: "session.tool.input.delta", data: { ...identity, id: "first", delta: '.txt"}' } },
      { type: "session.tool.input.started", data: { ...identity, id: "second", name: "edit" } },
    ])
    yield* publisher.publish(LLMEvent.toolInputDelta({ id: "second", name: "edit", text: '{"path":"two' }))
    yield* publisher.publish(LLMEvent.toolInputDelta({ id: "first", name: "read", text: "\n" }))
    yield* TestClock.adjust("100 millis")
    yield* publisher.publish(LLMEvent.toolInputDelta({ id: "second", name: "edit", text: '.txt"}' }))
    yield* publisher.flush()
    const deltas = f.published.filter(Schema.is(SessionEvent.Tool.Input.Delta)).map((event) => event.data)
    expect(deltas.filter((data) => data.id === "first")).toEqual([
      { ...identity, id: "first", delta: '{"path":' },
      { ...identity, id: "first", delta: '"one' },
      { ...identity, id: "first", delta: '.txt"}' },
      { ...identity, id: "first", delta: "\n" },
    ])
    expect(deltas.filter((data) => data.id === "second")).toEqual([
      { ...identity, id: "second", delta: '{"path":"two' },
      { ...identity, id: "second", delta: '.txt"}' },
    ])
    expect(f.published.filter(Schema.is(SessionEvent.Tool.Input.Ended)).map((event) => event.data)).toEqual([
      { ...identity, id: "first", text: '{"path":"one.txt"}\n' },
      { ...identity, id: "second", text: '{"path":"two.txt"}' },
    ])
    const settled = f.events()
    yield* TestClock.adjust("1 second")
    expect(f.events()).toEqual(settled)
  }),
)

for (const fixture of [
  { name: "atomic tool calls", events: [LLMEvent.toolCall({ id: "call", name: "read", input: { path: "file.txt" } })] },
  {
    name: "tool input without chunks",
    events: [LLMEvent.toolInputStart({ id: "call", name: "read" }), LLMEvent.toolInputEnd({ id: "call", name: "read" })],
  },
  {
    name: "empty-only tool input chunks",
    events: [
      LLMEvent.toolInputStart({ id: "call", name: "read" }),
      LLMEvent.toolInputDelta({ id: "call", name: "read", text: "" }),
      LLMEvent.toolInputDelta({ id: "call", name: "read", text: "" }),
      LLMEvent.toolInputEnd({ id: "call", name: "read" }),
    ],
  },
]) {
  it.effect(`does not manufacture deltas for ${fixture.name}`, () =>
    Effect.gen(function* () {
      const f = yield* toolInputFixture
      const publisher = createLLMEventPublisher(f.bus, f.input)
      yield* Effect.forEach(fixture.events, publisher.publish, { discard: true })
      yield* publisher.flush()
      yield* TestClock.adjust("1 second")
      expect(f.published.filter(Schema.is(SessionEvent.Tool.Input.Delta))).toEqual([])
      expect(f.published.filter(Schema.is(SessionEvent.Tool.Input.Ended)).map((event) => event.data)).toEqual([
        { sessionID: f.input.sessionID, assistantMessageID: f.input.assistantMessageID, id: "call", text: "" },
      ])
      for (const event of f.events().filter((event) => event.type.startsWith("session.tool.")))
        expect(event.data).toMatchObject({
          sessionID: f.input.sessionID,
          assistantMessageID: f.input.assistantMessageID,
          id: "call",
        })
    }),
  )
}
