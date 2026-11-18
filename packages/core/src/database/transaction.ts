export * as DatabaseTransaction from "./transaction"

import { Context, Effect } from "effect"
import type { Database } from "./database"

const PostCommit = Context.Reference<Array<Effect.Effect<void>> | undefined>("opencode/DatabaseTransaction.PostCommit", {
  defaultValue: () => undefined,
})

export const afterCommit = (work: Effect.Effect<void>) =>
  Effect.gen(function* () {
    const pending = yield* PostCommit
    if (!pending) return yield* work
    pending.push(work)
  })

/** Defer observer effects until the whole batch commits; rollback drops them. */
export const batch = <A, E, R>(db: Database.Interface["db"], work: Effect.Effect<A, E, R>) =>
  Effect.uninterruptible(
    Effect.gen(function* () {
      const pending: Array<Effect.Effect<void>> = []
      const value = yield* db.transaction(() => Effect.provideService(work, PostCommit, pending), {
        behavior: "immediate",
      })
      yield* Effect.forEach(pending, afterCommit, { discard: true })
      return value
    }),
  )
