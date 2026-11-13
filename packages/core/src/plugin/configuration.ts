export * as PluginConfiguration from "./configuration.js"

import type { ConfigDomain, Draft } from "@opencode/plugin/effect/config"
import { Config } from "@opencode/schema/config"
import { isDeepStrictEqual } from "node:util"
import { Context, Effect, Exit, Schema, Scope } from "effect"
import { State } from "../state.js"
import { ConfigDraftResolve } from "../config/draft-resolve.js"

export const make = Effect.fn("PluginConfiguration.make")(function* (request: Effect.Effect<void>) {
  const registrations = new Set<(draft: Draft) => Effect.Effect<void, never, Scope.Scope>>()
  let admitting = true
  let current: Scope.Closeable | undefined
  const configure: ConfigDomain["configure"] = Effect.fn("PluginConfiguration.configure")(function* (callback) {
    if (!admitting)
      return yield* Effect.die(new Error("Configuration callbacks must be registered during plugin setup"))
    const context = yield* Effect.context<Scope.Scope>()
    const captured = Effect.fnUntraced(function* (draft: Draft) {
      const execution = yield* Effect.context<Scope.Scope>()
      yield* callback(draft).pipe(Effect.provideContext(Context.merge(context, execution)))
    })
    registrations.add(captured)
    const dispose = Effect.suspend(() => (registrations.delete(captured) ? request : Effect.void))
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        registrations.delete(captured)
      }),
    )
    return { dispose }
  })
  const close = Effect.fn("PluginConfiguration.close")(function* () {
    const previous = current
    current = undefined
    if (previous) yield* Scope.close(previous, Exit.void)
  })
  yield* Effect.addFinalizer(() => close())

  return {
    configure,
    seal: () => {
      admitting = false
    },
    registered: () => registrations.size > 0,
    close,
    run: Effect.fn("PluginConfiguration.run")(function* (draft: Draft, validate: () => void) {
      yield* close()
      if (!registrations.size) return
      const parent = yield* Scope.Scope
      const scope = yield* Scope.fork(parent)
      current = scope
      const plugins = structuredClone(draft.plugins)
      yield* State.guard(
        "config",
        Effect.gen(function* () {
          for (const callback of registrations) yield* callback(draft).pipe(Effect.provideService(Scope.Scope, scope))
          if (!isDeepStrictEqual(plugins, draft.plugins))
            return yield* Effect.die(new Error("Configuration callbacks cannot change plugins"))
          yield* Schema.decodeUnknownEffect(Config.Info, { onExcessProperty: "error" })(
            ConfigDraftResolve.plain(draft),
          ).pipe(Effect.orDie)
          yield* Effect.sync(validate)
        }),
      )
    }),
  }
})

export type Interface = Effect.Success<ReturnType<typeof make>>
