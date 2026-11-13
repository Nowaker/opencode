export * as ConfigSnapshot from "./snapshot.js"

import type { Entry } from "@opencode/schema/config"
import type { Event } from "@opencode/schema/event"
import { isDeepStrictEqual } from "node:util"
import { Effect, PubSub, Stream } from "effect"
import { State } from "../state.js"

/** Keeps source discovery separate from the configuration committed by plugin activation. */
export const make = Effect.fn("ConfigSnapshot.make")(function* (
  initial: Entry[],
  publish: (origin: string) => Effect.Effect<void>,
) {
  const changes = yield* PubSub.sliding<void>(1)
  const observers = new Set<Effect.Effect<void>>()
  let source = initial
  let current = initial
  let managed = false
  let revision = 0
  let committed = 0
  const origin = crypto.randomUUID()

  const commit = Effect.fn("ConfigSnapshot.commit")(function* (entries: Entry[]) {
    if (isDeepStrictEqual(current, entries) && revision === committed) return
    current = entries
    committed = revision
    yield* Effect.forEach(observers, (refresh) => refresh, { discard: true })
    yield* publish(origin)
  })
  const request = PubSub.publish(changes, undefined).pipe(Effect.asVoid)

  return {
    entries: () => Effect.sync(() => current),
    raw: () => source,
    replace: Effect.fn("ConfigSnapshot.replace")(function* (entries: Entry[], notify = true) {
      source = entries
      revision++
      if (managed) return yield* request
      if (notify) return yield* commit(entries)
      current = entries
      committed = revision
    }),
    configuration: {
      entries: () => Effect.sync(() => source),
      changes: () => Stream.fromPubSub(changes),
      request,
      commit,
      published: (event: Pick<Event.Payload, "metadata" | "type">) => event.metadata?.configurationSnapshot === origin,
      manage: Effect.acquireRelease(
        Effect.sync(() => {
          managed = true
        }),
        () =>
          Effect.sync(() => {
            managed = false
          }),
      ).pipe(Effect.asVoid),
      observe: Effect.fn("ConfigSnapshot.observe")(function* <R>(refresh: Effect.Effect<void, never, R>) {
        const context = yield* Effect.context<R>()
        const observed = Effect.gen(function* () {
          const inherit = yield* State.inherit()
          yield* refresh.pipe(inherit, Effect.provideContext(context))
        })
        observers.add(observed)
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            observers.delete(observed)
          }),
        )
      }),
    },
  }
})

export type Configuration = Effect.Success<ReturnType<typeof make>>["configuration"]
