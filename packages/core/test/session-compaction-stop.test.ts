import { expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { SessionEvent } from "@opencode/core/session/event"
import { Effect, Fiber, Stream } from "effect"
import { hooks, it, loaded, manual, provider, seed, store, user } from "./fixture/compaction"

for (const chunks of [
  ["## Objective\nNarrative\n## User", " Prompts\nUNTRUSTED_RECORD"],
  ["## Objective\nNarrative", "\n## User Prompts\nUNTRUSTED_RECORD"],
  ["## Objective\nNarrative\n## User Prompts\nUNTRUSTED_RECORD"],
]) {
  it.effect(`compaction filters a local boundary before publishing ${chunks.length} provider chunks`, () =>
    Effect.gen(function* () {
      const session = yield* seed
      provider.chunks = chunks
      provider.finish = "length"
      const registry = yield* hooks
      yield* registry.register("session", "compaction", (event) =>
        Effect.sync(() => {
          event.options.stop = ["\n## User Prompts"]
        }),
      )
      const bus = yield* Bus.Service
      const deltas: string[] = []
      const observing = yield* bus.subscribe(SessionEvent.Compaction.Delta).pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            deltas.push(event.data.text)
          }),
        ),
        Effect.forkChild,
      )
      yield* Effect.yieldNow

      expect(yield* manual(loaded(session, [user("Retain the release")]))).toEqual({ status: "completed" })
      yield* Fiber.interrupt(observing)
      expect(deltas.join("")).toBe("## Objective\nNarrative")
      const sessions = yield* store
      expect(yield* sessions.context(session.id)).toMatchObject([
        { summary: "## Objective\nNarrative", tokens: { input: 15, output: 6 } },
      ])
    }),
  )
}

it.effect("an unmatched boundary prefix remains in the completed summary", () =>
  Effect.gen(function* () {
    const session = yield* seed
    provider.chunks = ["## Objective\nNarrative\n## Us", "ual work"]
    const registry = yield* hooks
    yield* registry.register("session", "compaction", (event) =>
      Effect.sync(() => {
        event.stopSequences = ["\n## User Prompts"]
      }),
    )

    expect(yield* manual(loaded(session, [user("Keep the task")]))).toEqual({ status: "completed" })
    const sessions = yield* store
    expect(yield* sessions.context(session.id)).toMatchObject([{ summary: provider.chunks.join("") }])
    expect(provider.requests[0]?.stop).toEqual(["\n## User Prompts"])
  }),
)

it.effect("a partial boundary at successful stream end is released", () =>
  Effect.gen(function* () {
    const session = yield* seed
    provider.chunks = ["## Objective\nNarrative\n## Us"]
    const registry = yield* hooks
    yield* registry.register("session", "compaction", (event) =>
      Effect.sync(() => {
        event.stopSequences = ["\n## User Prompts"]
      }),
    )

    expect(yield* manual(loaded(session, [user("Keep the task")]))).toEqual({ status: "completed" })
    const sessions = yield* store
    expect(yield* sessions.context(session.id)).toMatchObject([{ summary: provider.chunks[0] }])
  }),
)

it.effect("a stop boundary before any narrative fails instead of appending a ledger to empty text", () =>
  Effect.gen(function* () {
    const session = yield* seed
    provider.chunks = ["\n## User Prompts\nmodel-generated record"]
    const registry = yield* hooks
    yield* registry.register("session", "compaction", (event) =>
      Effect.sync(() => {
        event.stopSequences = ["\n## User Prompts"]
      }),
    )
    let completions = 0
    yield* registry.register("session", "experimental.compaction.summary", () =>
      Effect.sync(() => {
        completions++
      }),
    )

    expect(yield* manual(loaded(session, [user("Keep the task")]))).toMatchObject({
      status: "failed",
      error: { type: "compaction.failed" },
    })
    expect(completions).toBe(0)
    const sessions = yield* store
    expect(yield* sessions.context(session.id)).toMatchObject([{ status: "failed", tokens: { input: 15, output: 6 } }])
  }),
)
