import { expect } from "bun:test"
import { SessionCompaction } from "@opencode/core/session/compaction"
import { SessionMessage } from "@opencode/core/session/message"
import { DateTime, Deferred, Effect, Fiber } from "effect"
import { hooks, it, loaded, manual, provider, seed, store, user } from "./fixture/compaction"

it.effect("summary completion is awaited before the durable compaction completes", () =>
  Effect.gen(function* () {
    const session = yield* seed
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const inputID = SessionMessage.ID.create()
    const registry = yield* hooks
    yield* registry.register("session", "experimental.compaction.summary", (event) =>
      Effect.gen(function* () {
        expect(event.messageID).toBe(inputID)
        yield* Deferred.succeed(entered, undefined)
        yield* Deferred.await(release)
        event.text += "\nFROZEN_LEDGER"
        event.metadata.ledger = { frozen: true }
      }),
    )
    const running = yield* manual(loaded(session, [user("Keep the release constraints")]), inputID).pipe(
      Effect.forkChild,
    )
    yield* Deferred.await(entered)
    const sessions = yield* store
    const messages = yield* sessions.context(session.id)
    expect(messages).toMatchObject([{ id: inputID, status: "running" }])
    yield* Deferred.succeed(release, undefined)
    expect(yield* Fiber.join(running)).toEqual({ status: "completed" })
    expect(yield* sessions.context(session.id)).toMatchObject([
      {
        id: inputID,
        summary: "## Objective\nGenerated narrative\nFROZEN_LEDGER",
        metadata: { ledger: { frozen: true } },
      },
    ])
  }),
)

it.effect("a rejected summary callback fails compaction without discarding generated usage", () =>
  Effect.gen(function* () {
    const session = yield* seed
    const registry = yield* hooks
    yield* registry.register("session", "experimental.compaction.summary", () =>
      Effect.promise(() => Promise.reject(new Error("ledger snapshot unavailable"))),
    )

    expect(yield* manual(loaded(session, [user("Remember this obligation")]))).toMatchObject({
      status: "failed",
      error: { type: "compaction.failed", message: "ledger snapshot unavailable" },
    })
    const sessions = yield* store
    expect(yield* sessions.context(session.id)).toMatchObject([
      { status: "failed", tokens: { input: 15, output: 6 }, cost: 0.000027 },
    ])
    expect(provider.requests).toHaveLength(1)
  }),
)

it.effect("the preparation snapshot and actual manual marker reach textual supplied-result completion", () =>
  Effect.gen(function* () {
    const session = yield* seed
    const old = user("Older request")
    const tail = user("Retained request")
    const registry = yield* hooks
    let generationID: string | undefined
    yield* registry.register("session", "compaction", (event) =>
      Effect.sync(() => {
        generationID = event.compaction?.generationID
        expect(event.compaction).toMatchObject({
          boundaryID: tail.id,
          keepID: tail.id,
          replacedMessageIDs: [old.id],
          retainedMessages: [{ id: tail.id, role: "user", rawText: tail.text, text: `[User]: ${tail.text}` }],
        })
        event.metadata = { ledger: "frozen before generation" }
        event.result = {
          summary: "## Objective\nSupplied narrative",
          native: { responseId: "provider-metadata" },
          metadata: { custom: true },
        }
      }),
    )
    yield* registry.register("session", "experimental.compaction.summary", (event) =>
      Effect.sync(() => {
        expect(generationID).toBe(event.generationID)
        expect(event.metadata).toMatchObject({ ledger: "frozen before generation", custom: true })
        event.text += `\n${event.metadata.ledger}`
      }),
    )

    expect(yield* manual(loaded(session, [old, tail]))).toEqual({ status: "completed" })
    expect(provider.requests).toHaveLength(0)
    const sessions = yield* store
    expect(yield* sessions.context(session.id)).toMatchObject([
      { summary: "## Objective\nSupplied narrative\nfrozen before generation" },
    ])
  }),
)

it.effect("provider replacement windows bypass the textual completion hook", () =>
  Effect.gen(function* () {
    const session = yield* seed
    const registry = yield* hooks
    yield* registry.register("session", "compaction", (event) =>
      Effect.sync(() => {
        event.result = { summary: "unused plaintext", native: { messages: [] } }
      }),
    )
    let completions = 0
    yield* registry.register("session", "experimental.compaction.summary", () =>
      Effect.sync(() => {
        completions++
      }),
    )

    expect(yield* manual(loaded(session, [user("Keep the native window")]))).toEqual({ status: "completed" })
    expect(completions).toBe(0)
    expect(provider.requests).toHaveLength(0)
  }),
)

it.effect("prior-summary edits survive overflow flattening without restoring stored summary text", () =>
  Effect.gen(function* () {
    const session = yield* seed
    const previous = SessionMessage.CompactionCompleted.make({
      id: SessionMessage.ID.create(),
      type: "compaction",
      status: "completed",
      reason: "manual",
      summary: "STORED_SUMMARY_MUST_NOT_RETURN",
      metadata: { recent: "OLD_RECENT_CONTEXT" },
      time: { created: DateTime.makeUnsafe(0) },
    })
    const registry = yield* hooks
    yield* registry.register("session", "compaction", (event) =>
      Effect.sync(() => {
        event.previousSummary = "PROJECTED_PRIOR_SUMMARY"
      }),
    )
    const compaction = yield* SessionCompaction.Service

    expect(
      yield* compaction.compact({ reason: "overflow", context: loaded(session, [previous, user("Continue")]) }),
    ).toEqual({ status: "completed" })
    const sent = JSON.stringify(provider.requests[0]?.messages)
    expect(sent).toContain("PROJECTED_PRIOR_SUMMARY")
    expect(sent).not.toContain("STORED_SUMMARY_MUST_NOT_RETURN")
  }),
)
