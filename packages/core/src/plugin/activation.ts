export * as PluginActivation from "./activation.js"

import { Cause, Context, Effect, Exit, Logger, References, Scope } from "effect"
import type { Generation, Interface } from "./service.js"
import { PluginHost } from "./host.js"
import { PluginConfiguration } from "./configuration.js"
import { State } from "../state.js"

export type Activation = {
  readonly plugin: Generation
  readonly scope: Scope.Closeable
  readonly configuration: PluginConfiguration.Interface
  readonly configure: (
    draft: Parameters<PluginConfiguration.Interface["run"]>[0],
    validate: () => void,
  ) => Effect.Effect<void>
  failure?: { readonly error: string; readonly ref: string }
}

export const load = Effect.fn("PluginActivation.load")(function* (
  plugin: Generation,
  input: {
    readonly scope: Scope.Closeable
    readonly list: Interface["list"]
    readonly request: Effect.Effect<void>
    readonly failed: (input: {
      activation: Activation
      failure: State.Failure
      refresh: Effect.Effect<void>
      ref: string
    }) => void
  },
) {
  const scope = yield* Scope.fork(input.scope)
  const configuration = yield* PluginConfiguration.make(input.request).pipe(Effect.provideService(Scope.Scope, scope))
  const inherit = yield* State.inherit()
  const grouped = State.group((failure, refresh) => {
    activation.failure = {
      error: `Plugin disabled after ${failure.state}.transform failed. Check server logs for details.`,
      ref: `err_${crypto.randomUUID().slice(0, 8)}`,
    }
    input.failed({ activation, failure, refresh, ref: activation.failure.ref })
  })
  const activation: Activation = {
    plugin,
    scope,
    configuration,
    configure: (draft, validate) =>
      configuration.run(draft, validate).pipe(grouped, Effect.provideService(Scope.Scope, scope)),
  }
  const host = yield* PluginHost.make({ list: input.list }, plugin.id, configuration)
  const exit = yield* Effect.suspend(() => plugin.effect(host)).pipe(
    grouped,
    inherit,
    Effect.updateContext((context: Context.Context<never>) =>
      Context.make(Scope.Scope, scope).pipe(
        Context.add(Logger.CurrentLoggers, Context.get(context, Logger.CurrentLoggers)),
        Context.add(References.MinimumLogLevel, Context.get(context, References.MinimumLogLevel)),
      ),
    ),
    Effect.withSpan("Plugin.load", { attributes: { "plugin.id": plugin.id } }),
    Effect.onExit((exit) => (Exit.isFailure(exit) && !activation.failure ? Scope.close(scope, exit) : Effect.void)),
    Effect.exit,
  )
  configuration.seal()
  if (activation.failure || Exit.isSuccess(exit)) return { activation } as const
  yield* Effect.logWarning("failed to load plugin", { "plugin.id": plugin.id, cause: exit.cause })
  return { error: Cause.pretty(exit.cause) } as const
})
