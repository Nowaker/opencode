import { expect } from "bun:test"
import { Config } from "@opencode/core/config"
import { ConfigProviderPlugin } from "@opencode/core/config/plugin/provider"
import { Plugin } from "@opencode/core/plugin"
import { Provider } from "@opencode/core/provider"
import { Model } from "@opencode/core/model"
import { Command } from "@opencode/core/command"
import { Document, Info } from "@opencode/schema/config"
import { Deferred, Effect, Fiber, Schema } from "effect"
import { fromPromise } from "@opencode/plugin/promise/adapter"
import type { Registration } from "@opencode/plugin/promise/registration"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const document = (name: string) =>
  new Document({
    type: "document",
    info: Schema.decodeUnknownSync(Info)({
      providers: {
        fixture: {
          name,
          package: "@opencode/ai/providers/openai-compatible",
          settings: { baseURL: "http://127.0.0.1:12345/v1" },
          models: { mapped: { limit: { context: 8192, output: 512 } } },
        },
      },
    }),
  })

it.effect("awaits configuration in setup order before native provider consumers", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const config = yield* Config.Service
    const source = yield* Config.Test
    const providers = yield* Provider.Service
    const models = yield* Model.Service
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const laterSetup = { finished: false }
    yield* source.setEntries([document("Loaded provider")])
    const activation = yield* plugins
      .activate(
        [
          {
            id: "first",
            revision: "1",
            effect: (ctx) =>
              ctx.config
                .configure((draft) =>
                  Effect.gen(function* () {
                    expect(laterSetup.finished).toBe(true)
                    const provider = draft.providers?.fixture
                    if (!provider) return yield* Effect.die("loaded provider missing")
                    expect(provider.name).toBe("Loaded provider")
                    yield* Deferred.succeed(started, undefined)
                    yield* Deferred.await(release)
                    provider.name = "First edit"
                  }),
                )
                .pipe(Effect.asVoid),
          },
          {
            id: "second",
            revision: "1",
            effect: (ctx) =>
              Effect.gen(function* () {
                laterSetup.finished = true
                yield* ctx.config.configure((draft) =>
                  Effect.sync(() => {
                    const provider = draft.providers?.fixture
                    if (!provider) throw new Error("loaded provider missing")
                    expect(provider.name).toBe("First edit")
                    provider.name = "Configured provider"
                    provider.headers = { "x-configured": "yes" }
                    draft.model = { providerID: Provider.ID.make("fixture"), model: Model.ID.make("mapped") }
                  }),
                )
              }),
          },
        ],
        [],
        [
          {
            id: "native-provider",
            revision: "1",
            effect: (ctx) =>
              ConfigProviderPlugin.Plugin.effect(ctx).pipe(Effect.provideService(Config.Service, config)),
          },
        ],
      )
      .pipe(Effect.forkChild({ startImmediately: true }))
    yield* Deferred.await(started)
    expect(yield* providers.get(Provider.ID.make("fixture"))).toBeUndefined()
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(activation)
    yield* plugins.awaitActivation
    expect(yield* providers.get(Provider.ID.make("fixture"))).toMatchObject({
      name: "Configured provider",
      settings: { baseURL: "http://127.0.0.1:12345/v1" },
      headers: { "x-configured": "yes" },
    })
    expect(yield* models.default()).toMatchObject({ providerID: "fixture", id: "mapped" })
  }),
)

it.effect("reloads fresh source drafts and restores loaded values when the plugin unloads", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const config = yield* Config.Service
    const source = yield* Config.Test
    const providers = yield* Provider.Service
    const counts = { setup: 0, configure: 0 }
    const external: Plugin.Generation = {
      id: "configured",
      revision: "1",
      effect: (ctx) =>
        Effect.gen(function* () {
          counts.setup++
          yield* ctx.config.configure((draft) =>
            Effect.sync(() => {
              counts.configure++
              const provider = draft.providers?.fixture
              if (!provider) throw new Error("loaded provider missing")
              provider.name = `${provider.name} configured`
            }),
          )
        }),
    }
    const post: Plugin.Generation[] = [
      {
        id: "native-provider",
        revision: "1",
        effect: (ctx) => ConfigProviderPlugin.Plugin.effect(ctx).pipe(Effect.provideService(Config.Service, config)),
      },
    ]
    yield* source.setEntries([document("First")])
    yield* plugins.activate([external], [], post)
    expect((yield* providers.get(Provider.ID.make("fixture")))?.name).toBe("First configured")
    yield* source.setEntries([document("Second")])
    yield* plugins.activate([external], [], post)
    expect((yield* providers.get(Provider.ID.make("fixture")))?.name).toBe("Second configured")
    expect(counts).toEqual({ setup: 1, configure: 2 })
    yield* plugins.activate([], [], post)
    expect((yield* providers.get(Provider.ID.make("fixture")))?.name).toBe("Second")
  }),
)

it.effect("rolls back a failed owner's draft and registrations without retrying its revision", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const config = yield* Config.Service
    const source = yield* Config.Test
    const providers = yield* Provider.Service
    const commands = yield* Command.Service
    const calls = { broken: 0 }
    yield* source.setEntries([document("Loaded")])
    const external: Plugin.Generation = {
      id: "broken",
      revision: "1",
      effect: (ctx) =>
        Effect.gen(function* () {
          yield* ctx.command.transform((editor) => editor.add({ name: "partial", execute: () => Effect.void }))
          yield* ctx.config.configure((draft) =>
            Effect.gen(function* () {
              calls.broken++
              const provider = draft.providers?.fixture
              if (provider) provider.name = "Partial edit"
              return yield* Effect.die(new Error("configuration rejected"))
            }),
          )
        }),
    }
    const post: Plugin.Generation[] = [
      {
        id: "native-provider",
        revision: "1",
        effect: (ctx) => ConfigProviderPlugin.Plugin.effect(ctx).pipe(Effect.provideService(Config.Service, config)),
      },
    ]
    yield* plugins.activate([external], [], post)
    yield* plugins.awaitActivation
    expect((yield* providers.get(Provider.ID.make("fixture")))?.name).toBe("Loaded")
    expect(yield* commands.get("partial")).toBeUndefined()
    expect((yield* plugins.list()).find((plugin) => plugin.id === "broken")?.state.status).toBe("failed")
    yield* plugins.activate([external], [], post)
    expect(calls.broken).toBe(1)
  }),
)

it.effect("disposes Promise callback registrations before rerun and explicit removal", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const source = yield* Config.Test
    const commands = yield* Command.Service
    const registration: { current?: Registration } = {}
    const definition = fromPromise({
      id: "promise-config",
      setup: async (ctx) => {
        registration.current = await ctx.config.configure(async (draft) => {
          const name = draft.providers?.fixture?.name
          if (!name) throw new Error("loaded provider missing")
          await ctx.command.transform((editor) => editor.add({ name, execute: async () => undefined }))
        })
      },
    })
    const generation: Plugin.Generation = { ...definition, revision: "1" }
    yield* source.setEntries([document("first")])
    yield* plugins.activate([generation])
    expect(yield* commands.get("first")).toBeDefined()
    yield* source.setEntries([document("second")])
    yield* plugins.activate([generation])
    expect(yield* commands.get("first")).toBeUndefined()
    expect(yield* commands.get("second")).toBeDefined()
    yield* Effect.promise(() => registration.current?.dispose() ?? Promise.resolve())
    yield* plugins.activate([generation])
    expect(yield* commands.get("second")).toBeUndefined()
  }),
)

it.effect("discards an awaiting candidate when its raw source revision changes", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const config = yield* Config.Service
    const source = yield* Config.Test
    const providers = yield* Provider.Service
    if (!config.configuration) return yield* Effect.die("configuration boundary missing")
    yield* config.configuration.manage
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const passes = { count: 0 }
    const external: Plugin.Generation = {
      id: "revisions",
      revision: "1",
      effect: (ctx) =>
        ctx.config
          .configure((draft) =>
            Effect.gen(function* () {
              passes.count++
              if (passes.count === 2) {
                yield* Deferred.succeed(started, undefined)
                yield* Deferred.await(release)
              }
              const provider = draft.providers?.fixture
              if (provider) provider.name += " configured"
            }),
          )
          .pipe(Effect.asVoid),
    }
    const post: Plugin.Generation[] = [
      {
        id: "native-provider",
        revision: "1",
        effect: (ctx) => ConfigProviderPlugin.Plugin.effect(ctx).pipe(Effect.provideService(Config.Service, config)),
      },
    ]
    yield* source.setEntries([document("First")])
    yield* plugins.activate([external], [], post)
    yield* source.setEntries([document("Stale")])
    const activation = yield* plugins.activate([external], [], post).pipe(Effect.forkChild({ startImmediately: true }))
    yield* Deferred.await(started)
    expect((yield* providers.get(Provider.ID.make("fixture")))?.name).toBe("First configured")
    yield* source.setEntries([document("Newest")])
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(activation)
    expect((yield* providers.get(Provider.ID.make("fixture")))?.name).toBe("Newest configured")
    expect(passes.count).toBe(3)
  }),
)
