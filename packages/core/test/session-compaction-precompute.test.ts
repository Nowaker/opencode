import { expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { LanguageModel } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols"
import { SessionCompaction } from "@opencode/core/session/compaction"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { Bus } from "@opencode/core/bus"
import { SessionEvent } from "@opencode/core/session/event"
import { Deferred, Effect, Fiber, Schema, Stream } from "effect"
import { hooks, it, loaded, manual, model, provider, seed, store, user } from "./fixture/compaction"

const measured = (text: string, input: number) =>
  Schema.decodeUnknownSync(SessionMessage.Assistant)({
    id: SessionMessage.ID.create(),
    type: "assistant",
    agent: Agent.defaultID,
    model: model.ref,
    content: [{ type: "text", text }],
    tokens: { input, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, completed: 1 },
  })

it.effect("background adoption binds the original frozen generation to the actual manual marker", () =>
  Effect.gen(function* () {
    const session = yield* seed
    const compaction = yield* SessionCompaction.Service
    yield* compaction.transform((editor) => editor.configure({ precompute: true }))
    const second = user("Second question")
    const anchor = measured("Second answer", 156_000)
    const near = [user("First question"), measured("First answer", 80_000), second, anchor]
    const later = [...near, user("Third question"), measured("Third answer", 182_000)]
    const prepared = yield* Deferred.make<void>()
    const registry = yield* hooks
    let generationID: string | undefined
    let completions = 0
    yield* registry.register("session", "compaction", (event) =>
      Effect.sync(() => {
        generationID = event.compaction?.generationID
        expect(event.compaction?.messageID).toBeUndefined()
        expect(event.compaction?.boundaryID).toBe(second.id)
        event.metadata = { snapshot: "frozen before later messages" }
      }).pipe(Effect.andThen(Deferred.succeed(prepared, undefined))),
    )
    const inputID = SessionMessage.ID.create()
    yield* registry.register("session", "experimental.compaction.summary", (event) =>
      Effect.sync(() => {
        completions++
        expect(generationID).toBe(event.generationID)
        expect(event.messageID).toBe(inputID)
        expect(event.reason).toBe("manual")
        expect(event.boundaryID).toBe(second.id)
        expect(event.keepID).toBe(anchor.id)
        expect(event.retainedMessages.map((message) => message.id)).toEqual(later.slice(3).map((message) => message.id))
        expect(event.metadata.snapshot).toBe("frozen before later messages")
        event.text += "\nFROZEN_LEDGER"
      }),
    )

    yield* compaction.precompute(Effect.succeed(loaded(session, near)))
    yield* Deferred.await(prepared)
    expect(completions).toBe(0)
    expect(yield* manual(loaded(session, later), inputID)).toEqual({ status: "completed" })
    expect(completions).toBe(1)
    expect(provider.requests).toHaveLength(1)
    const sessions = yield* store
    const messages = yield* sessions.context(session.id)
    expect(messages).toMatchObject([
      { id: inputID, summary: "## Objective\nGenerated narrative\nFROZEN_LEDGER", tokens: { input: 15, output: 6 } },
    ])
  }),
)

it.effect("background adoption retains the generating model when the conversation uses another model", () =>
  Effect.gen(function* () {
    const session = yield* seed
    const compaction = yield* SessionCompaction.Service
    yield* compaction.transform((editor) => editor.configure({ precompute: true }))
    const selected = SessionRunnerModel.resolved(
      LanguageModel.make({ id: "different-summary", provider: "test", route: OpenAIChat.route }),
      { capabilities: model.capabilities, cost: model.cost, limit: model.limit },
    )
    provider.summaryModel = selected
    const agents = yield* Agent.Service
    yield* agents.transform((editor) =>
      editor.update(Agent.ID.make("compaction"), (agent) => {
        agent.model = selected.ref
      }),
    )
    const near = [user("First"), measured("First answer", 80_000), user("Second"), measured("Second answer", 156_000)]
    const registry = yield* hooks
    let generations = 0
    let generationID: string | undefined
    yield* registry.register("session", "compaction", (event) =>
      Effect.sync(() => {
        generations++
        generationID = event.compaction?.generationID
        expect(event.model).toEqual(selected.ref)
        expect(event.compaction?.conversationModel).toEqual(model.ref)
        event.metadata = { snapshot: "original" }
      }),
    )
    yield* registry.register("session", "experimental.compaction.summary", (event) =>
      Effect.sync(() => {
        expect(generationID).toBe(event.generationID)
        expect(event.model).toEqual(selected.ref)
        expect(event.conversationModel).toEqual(model.ref)
        expect(event.metadata.snapshot).toBe("original")
      }),
    )
    const bus = yield* Bus.Service
    const generated = yield* bus
      .subscribe(SessionEvent.UsageRecorded)
      .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild)
    yield* Effect.yieldNow

    yield* compaction.precompute(Effect.succeed(loaded(session, near)))
    yield* Fiber.join(generated)
    expect(yield* manual(loaded(session, near))).toEqual({ status: "completed" })
    expect(generations).toBe(1)
    expect(provider.requests).toHaveLength(1)
    const sessions = yield* store
    expect(yield* sessions.context(session.id)).toMatchObject([{ model: selected.ref }])
  }),
)

it.effect("a failed speculative preparation fails adoption instead of silently generating again", () =>
  Effect.gen(function* () {
    const session = yield* seed
    const compaction = yield* SessionCompaction.Service
    yield* compaction.transform((editor) => editor.configure({ precompute: true }))
    const near = [user("First"), measured("First answer", 80_000), user("Second"), measured("Second answer", 156_000)]
    const registry = yield* hooks
    yield* registry.register("session", "compaction", () => Effect.die(new Error("frozen snapshot failed")))
    yield* compaction.precompute(Effect.succeed(loaded(session, near)))

    expect(yield* manual(loaded(session, near))).toMatchObject({
      status: "failed",
      error: { message: "frozen snapshot failed" },
    })
    expect(provider.requests).toHaveLength(0)
  }),
)

it.effect("automatic completion uses the projected Started identity", () =>
  Effect.gen(function* () {
    const session = yield* seed
    const registry = yield* hooks
    let messageID: string | undefined
    yield* registry.register("session", "experimental.compaction.summary", (event) =>
      Effect.sync(() => {
        messageID = event.messageID
      }),
    )
    const compaction = yield* SessionCompaction.Service

    expect(yield* compaction.compact({ reason: "overflow", context: loaded(session, [user("Keep this")]) })).toEqual({
      status: "completed",
    })
    const sessions = yield* store
    const messages = yield* sessions.context(session.id)
    expect(messages).toHaveLength(1)
    expect(messageID).toBe(messages[0]?.id)
  }),
)
