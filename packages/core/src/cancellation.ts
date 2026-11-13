export * as Cancellation from "./cancellation.js"
export { Result } from "@opencode/schema/cancellation"

import { Effect, Fiber, Scope } from "effect"
import type { Result } from "@opencode/schema/cancellation"

export const make = Effect.gen(function* () {
  const scope = yield* Scope.Scope
  const context = yield* Effect.context<never>()
  return Effect.fnUntraced(function* <E>(work: Effect.Effect<Result, E>) {
    const stop = yield* work.pipe(Effect.forkIn(scope, { startImmediately: true }), Effect.setContext(context))
    const result = yield* Fiber.join(stop).pipe(Effect.timeoutOption("1 second"))
    return result._tag === "Some" ? result.value : { status: "requested" as const }
  })
})
