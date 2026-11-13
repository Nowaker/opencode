import { describe, expect } from "bun:test"
import { Config } from "@opencode/core/config"
import { ConfigDraft } from "@opencode/core/config/draft"
import { ConfigAgentPlugin } from "@opencode/core/config/plugin/agent"
import { ConfigProviderPlugin } from "@opencode/core/config/plugin/provider"
import { ConfigReferencePlugin } from "@opencode/core/config/plugin/reference"
import { Agent } from "@opencode/core/agent"
import { Location } from "@opencode/core/location"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Provider } from "@opencode/core/provider"
import { Reference } from "@opencode/core/reference"
import { Document, Info, type Entry } from "@opencode/schema/config"
import { AbsolutePath } from "@opencode/schema/schema"
import { Effect, Schema } from "effect"
import path from "path"
import { PluginTestLayer } from "../plugin/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(PluginTestLayer)
const decode = Schema.decodeUnknownSync(Info)
const document = (info: unknown) => new Document({ type: "document", info: decode(info) })
const loadProviders = Effect.fn(function* (entries: Entry[]) {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin, "draft-test")
  yield* ConfigProviderPlugin.Plugin.effect(host).pipe(Effect.provide(Config.testLayer(entries)))
})

describe("ConfigDraft native consumers", () => {
  for (const edit of [
    { name: "an unrelated draft edit", baseURL: "https://last.example/v1" },
    { name: "a later source endpoint edit", baseURL: "https://edited.example/v1" },
  ]) {
    it.effect(`retains the loaded base captured by a layered alias after ${edit.name}`, () =>
      Effect.gen(function* () {
        const entries = [
          document({ providers: { source: { settings: { baseURL: "https://first.example/v1" } } } }),
          document({ providers: { alias: { canonical: "source" } } }),
          document({ providers: { source: { settings: { baseURL: "https://last.example/v1" } } } }),
        ]
        const before = ConfigDraft.resolve(entries)
        const after = ConfigDraft.resolve(entries)
        after.shell = "/bin/sh"
        if (!after.providers?.source.settings) throw new Error("missing provider settings")
        after.providers.source.settings.baseURL = edit.baseURL
        const projected = ConfigDraft.project(entries, before, after)

        yield* loadProviders(projected)

        const providers = yield* Provider.Service
        expect((yield* providers.get(Provider.ID.make("alias")))?.settings?.baseURL).toBe("https://first.example/v1")
        expect((yield* providers.get(Provider.ID.make("source")))?.settings?.baseURL).toBe(edit.baseURL)
        expect(projected[0]).toBe(entries[0])
        expect(projected[1]).toBe(entries[1])
      }),
    )
  }

  it.effect("changes provider name and headers while retaining its loaded baseURL", () =>
    Effect.gen(function* () {
      const entries = [
        document({
          providers: {
            proxy: { settings: { baseURL: "https://loaded.example/v1" }, headers: { "X-Keep": "keep" } },
          },
        }),
        document({ providers: { proxy: { name: "old", headers: { "X-Route": "old" } } } }),
      ]
      const before = ConfigDraft.resolve(entries)
      const after = ConfigDraft.resolve(entries)
      if (!after.providers) throw new Error("missing providers")
      after.providers.proxy.name = "new"
      after.providers.proxy.headers = { "X-Keep": "keep", "X-Route": "new" }

      yield* loadProviders(ConfigDraft.project(entries, before, after))

      const providers = yield* Provider.Service
      const provider = yield* providers.get(Provider.ID.make("proxy"))
      expect(provider?.name).toBe("new")
      expect(provider?.settings?.baseURL).toBe("https://loaded.example/v1")
      expect(provider?.headers).toEqual({ "X-Keep": "keep", "X-Route": "new" })
    }),
  )

  it.effect("keeps source-relative references while resolving callback paths against the location", () =>
    Effect.gen(function* () {
      const entries = [
        new Document({
          type: "document",
          path: AbsolutePath.make("/configuration/opencode.json"),
          info: decode({
            references: { keep: "./keep", describe: { path: "./describe", description: "old" }, change: "./old" },
          }),
        }),
      ]
      const before = ConfigDraft.resolve(entries)
      const after = ConfigDraft.resolve(entries)
      after.references = {
        ...after.references,
        describe: { path: "./describe", description: "new" },
        change: "./changed",
        added: "./added",
      }
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin, "draft-test")

      yield* ConfigReferencePlugin.Plugin.effect(host).pipe(
        Effect.provide(Config.testLayer(ConfigDraft.project(entries, before, after))),
      )

      const references = yield* Reference.Service
      const location = yield* Location.Service
      const items = new Map((yield* references.list()).map((item) => [item.name, item]))
      expect(items.get("keep")?.path).toBe(AbsolutePath.make("/configuration/keep"))
      expect(items.get("describe")?.path).toBe(AbsolutePath.make("/configuration/describe"))
      expect(items.get("describe")?.description).toBe("new")
      expect(items.get("change")?.path).toBe(AbsolutePath.make(path.resolve(location.directory, "changed")))
      expect(items.get("added")?.path).toBe(AbsolutePath.make(path.resolve(location.directory, "added")))
    }),
  )

  it.effect("applies layered global and agent permissions once after editing another field", () =>
    Effect.gen(function* () {
      const entries = [
        document({
          permissions: [{ action: "read", resource: "draft/global-one", effect: "allow" }],
          agents: { review: { permissions: [{ action: "read", resource: "draft/agent-one", effect: "allow" }] } },
        }),
        document({
          permissions: [{ action: "read", resource: "draft/global-two", effect: "deny" }],
          agents: { review: { permissions: [{ action: "read", resource: "draft/agent-two", effect: "deny" }] } },
        }),
      ]
      const before = ConfigDraft.resolve(entries)
      const after = ConfigDraft.resolve(entries)
      if (!after.agents) throw new Error("missing agents")
      after.agents.review.description = "edited"
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin, "draft-test")

      yield* ConfigAgentPlugin.Plugin.effect(host).pipe(
        Effect.provide(Config.testLayer(ConfigDraft.apply(ConfigDraft.project(entries, before, after)))),
      )

      const agents = yield* Agent.Service
      const agent = yield* agents.get(Agent.ID.make("review"))
      expect(
        agent?.permissions.filter((rule) => rule.resource.startsWith("draft/")).map((rule) => rule.resource),
      ).toEqual(["draft/global-one", "draft/global-two", "draft/agent-one", "draft/agent-two"])
      expect(agent?.description).toBe("edited")
    }),
  )
})
