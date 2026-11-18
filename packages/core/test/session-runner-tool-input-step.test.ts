import { expect } from "bun:test"
import { ai, LanguageModel, LLMEvent } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { TestLLM } from "@opencode/ai/testing"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionStep } from "@opencode/core/session/runner/step"
import { Snapshot } from "@opencode/core/snapshot"
import { SessionEvent } from "@opencode/schema/session-event"
import { Deferred, Effect, Exit, Fiber, Layer, Schema, Stream } from "effect"
import { TestClock } from "effect/testing"
import { toolInputFixture, toolInputLayer } from "./fixture/tool-input"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.merge(toolInputLayer, TestLLM.testLayer()))

it.effect("flushes interrupted tool input before Step settlement and never publishes a late delta", () =>
  Effect.gen(function* () {
    const f = yield* toolInputFixture
    const llm = yield* TestLLM.Test
    const paused = yield* Deferred.make<void>()
    const finalized = yield* Deferred.make<void>()
    const steps = yield* SessionStep.make.pipe(
      Effect.provide(
        Layer.mock(Snapshot.Service)({
          capture: () => Effect.succeed(undefined),
          files: () => Effect.succeed([]),
        }),
      ),
    )
    const model = SessionRunnerModel.resolved(
      LanguageModel.make({ id: "test-model", provider: "test", route: OpenAIChat.route }),
      {
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        limit: { context: 100_000, output: 1_000 },
        cost: [],
      },
    )
    yield* llm.push(
      Stream.fromIterable([
        LLMEvent.toolInputStart({ id: "interrupted-call", name: "read" }),
        LLMEvent.toolInputDelta({ id: "interrupted-call", name: "read", text: '{"path":' }),
        LLMEvent.toolInputDelta({ id: "interrupted-call", name: "read", text: '"file' }),
      ]).pipe(
        Stream.concat(Stream.fromEffect(Deferred.succeed(paused, undefined).pipe(Effect.andThen(Effect.never)))),
        Stream.ensuring(Deferred.succeed(finalized, undefined)),
      ),
    )
    const run = yield* steps
      .attempt({
        isLocationClosed: () => false,
        sessionID: f.input.sessionID,
        assistantMessageID: f.input.assistantMessageID,
        agent: f.input.agent,
        model,
        prepared: {
          retry: () => Effect.void,
          request: ai.request({ model: model.model, prompt: "Read the file" }),
          options: {},
          executeTool: () => Effect.die(new Error("Incomplete input must not execute a tool")),
        },
        retry: () => Effect.succeed({ retry: false }),
        recoverContinuation: true,
        recoverOverflow: Effect.succeed(false),
      })
      .pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Deferred.await(paused)
    yield* TestClock.adjust("99 millis")
    expect(f.published.filter(Schema.is(SessionEvent.Tool.Input.Delta))).toEqual([])
    expect(f.published.filter(Schema.is(SessionEvent.Tool.Input.Ended))).toEqual([])

    yield* Fiber.interrupt(run)
    expect(Exit.hasInterrupts(yield* Fiber.await(run))).toBe(true)
    expect(yield* Deferred.isDone(finalized)).toBe(true)
    expect(f.events().map((event) => event.type)).toEqual([
      "session.step.started",
      "session.tool.input.started",
      "session.tool.input.delta",
      "session.tool.input.ended",
      "session.step.streamed",
      "session.tool.failed",
      "session.step.failed",
    ])
    const identity = {
      sessionID: f.input.sessionID,
      assistantMessageID: f.input.assistantMessageID,
      id: "interrupted-call",
    }
    expect(f.published.filter(Schema.is(SessionEvent.Tool.Input.Delta)).map((event) => event.data)).toEqual([
      { ...identity, delta: '{"path":"file' },
    ])
    expect(f.published.filter(Schema.is(SessionEvent.Tool.Input.Ended)).map((event) => event.data)).toEqual([
      { ...identity, text: '{"path":"file' },
    ])
    expect(f.published.filter(Schema.is(SessionEvent.Tool.Failed)).map((event) => event.data)).toEqual([
      { ...identity, error: { type: "aborted", message: "Tool execution interrupted" }, executed: false },
    ])
    expect(f.published.filter(Schema.is(SessionEvent.Step.Failed)).map((event) => event.data)).toMatchObject([
      {
        sessionID: f.input.sessionID,
        assistantMessageID: f.input.assistantMessageID,
        error: { type: "aborted", message: "Step interrupted" },
      },
    ])
    const settled = f.events()
    yield* TestClock.adjust("1 second")
    expect(f.events()).toEqual(settled)
  }),
)
