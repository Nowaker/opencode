import { describe, expect, test } from "bun:test"
import { ConfigDraft } from "@opencode/core/config/draft"
import { ConfigIntegration } from "@opencode/core/config/integration"
import { ConfigManaged } from "@opencode/core/config/managed"
import { ManagedPolicy } from "@opencode/core/managed-policy"
import { Config } from "@opencode/schema/config"
import { IntegrationID } from "@opencode/schema/integration-id"
import { AbsolutePath } from "@opencode/schema/schema"
import { Schema } from "effect"

const decode = Schema.decodeUnknownSync(Config.Info)
const document = (info: unknown) => new Config.Document({ type: "document", info: decode(info) })

describe("ConfigDraft.project", () => {
  test("keeps every unchanged layered source and directory in its original position", () => {
    const entries = [
      document({ providers: { source: { settings: { baseURL: "https://first.example" } } } }),
      document({ providers: { alias: { canonical: "source" } } }),
      document({ providers: { source: { settings: { baseURL: "https://last.example" } } } }),
      new Config.Directory({ type: "directory", path: AbsolutePath.make("/discovery") }),
    ]
    const before = ConfigDraft.resolve(entries)
    const projected = ConfigDraft.project(entries, before, ConfigDraft.resolve(entries))

    expect(projected).toHaveLength(entries.length)
    projected.forEach((entry, index) => expect(entry).toBe(entries[index]))
  })

  test("removes a deleted command from earlier layers and subsequently discovered declarations", () => {
    const first = document({ commands: { review: { template: "earlier" }, keep: { template: "keep" } } })
    const entries = [
      first,
      new Config.Directory({ type: "directory", path: AbsolutePath.make("/discovery") }),
      document({ commands: { review: { template: "later" } } }),
    ]
    const before = ConfigDraft.resolve(entries)
    const after = ConfigDraft.resolve(entries)
    delete after.commands?.review
    const projected = ConfigDraft.project(entries, before, after)
    const expanded = projected.flatMap((entry) =>
      entry.type === "directory"
        ? [document({ commands: { review: { template: "discovered" }, discovered: { template: "keep discovered" } } })]
        : [entry],
    )

    const applied = ConfigDraft.apply(expanded)

    expect(ConfigDraft.resolve(applied).commands).toEqual({
      keep: { template: "keep" },
      discovered: { template: "keep discovered" },
    })
    expect(first.info.commands?.review.template).toBe("earlier")
  })

  test("replaces command definitions by name after expansion without retaining removed fields", () => {
    const entries = [document({ commands: { review: { template: "old", description: "old description" } } })]
    const before = ConfigDraft.resolve(entries)
    const after = ConfigDraft.resolve(entries)
    after.commands = { review: { template: "replacement" } }
    const projected = ConfigDraft.project(entries, before, after)

    const applied = ConfigDraft.apply([document({ commands: { review: { template: "discovered" } } }), ...projected])
    expect(ConfigDraft.resolve(applied).commands).toEqual({ review: { template: "replacement" } })
  })

  test("replays changed permission arrays once without duplicating untouched permissions", () => {
    const allow = { action: "read", resource: "one", effect: "allow" } as const
    const deny = { action: "read", resource: "two", effect: "deny" } as const
    const entries = [
      document({ permissions: [allow], agents: { review: { permissions: [allow] } } }),
      document({ permissions: [deny], agents: { review: { permissions: [deny] } } }),
    ]
    const before = ConfigDraft.resolve(entries)
    const after = ConfigDraft.resolve(entries)
    after.permissions?.shift()
    after.agents?.review.permissions?.reverse()
    const projected = ConfigDraft.project(entries, before, after)

    const result = ConfigDraft.resolve(ConfigDraft.apply(projected))

    expect(result.permissions).toEqual([deny])
    expect(result.agents?.review.permissions).toEqual([deny, allow])
    expect(ConfigDraft.resolve(entries).permissions).toEqual([allow, deny])
  })

  test("preserves integration connection attribution while editing its provider", () => {
    const integration = ConfigIntegration.make({
      integrationID: IntegrationID.make("console"),
      connection: { type: "env", name: "TEST_CONNECTION" },
      organization: "Example",
      info: Schema.decodeUnknownSync(ConfigIntegration.Remote)({
        providers: { proxy: { name: "old", settings: { baseURL: "https://proxy.example" } } },
        policies: [{ action: "provider.use", resource: "blocked", effect: "deny" }],
      }),
    })
    const before = ConfigDraft.resolve([integration])
    const after = ConfigDraft.resolve([integration])
    if (!after.providers) throw new Error("missing providers")
    after.providers.proxy.name = "new"

    const projected = ConfigDraft.apply(ConfigDraft.project([integration], before, after))

    const source = projected.find((entry) => entry instanceof ConfigIntegration.Document)
    expect(source).toBeInstanceOf(ConfigIntegration.Document)
    if (!(source instanceof ConfigIntegration.Document)) throw new Error("missing integration")
    expect(source.connection).toBe(integration.connection)
    expect(source.info.providers?.proxy).toEqual({ name: "new", settings: { baseURL: "https://proxy.example" } })
    expect(ManagedPolicy.statements(projected)[0]?.message).toBe("Blocked by Example's policy")
    expect(integration.info.providers?.proxy.name).toBe("old")
  })

  test("rejects plugin changes and protected policy changes without modifying sources", () => {
    const managed = new ConfigManaged.Document({
      type: "document",
      info: decode({ policies: [{ action: "provider.use", resource: "*", effect: "deny" }] }),
    })
    const entries = [managed, document({ plugins: ["example-plugin"] })]
    const before = ConfigDraft.resolve(entries)
    const after = ConfigDraft.resolve(entries)
    after.plugins = []
    expect(() => ConfigDraft.project(entries, before, after)).toThrow(ConfigDraft.EditError)
    after.plugins = before.plugins
    after.policies = []
    expect(() => ConfigDraft.project(entries, before, after)).toThrow(ConfigDraft.EditError)
    expect(managed.info.policies).toHaveLength(1)
  })

  test("deletes provider headers across case variants and composes subsequent callback edits", () => {
    const entries = [
      document({ providers: { proxy: { headers: { "X-Delete": "old" }, name: "old" } } }),
      document({ providers: { proxy: { headers: { "x-delete": "last", "X-Keep": "keep" } } } }),
    ]
    const before = ConfigDraft.resolve(entries)
    const after = ConfigDraft.resolve(entries)
    if (!after.providers) throw new Error("missing providers")
    delete after.providers.proxy.headers?.["x-delete"]
    after.providers.proxy.name = "first edit"
    const projected = ConfigDraft.project(entries, before, after)
    const next = ConfigDraft.resolve(projected)
    if (!next.providers) throw new Error("missing providers")
    next.providers.proxy.name = "second edit"

    const result = ConfigDraft.resolve(
      ConfigDraft.apply(ConfigDraft.project(projected, ConfigDraft.resolve(projected), next)),
    )

    expect(result.providers?.proxy).toEqual({ name: "second edit", headers: { "X-Keep": "keep" } })
  })

  test("preserves earliest-source policy authority when editing unprotected policy arrays", () => {
    const entries = [
      document({ policies: [{ action: "provider.use", resource: "proxy", effect: "allow" }] }),
      document({ policies: [{ action: "provider.use", resource: "proxy", effect: "deny" }] }),
    ]
    const before = ConfigDraft.resolve(entries)
    const after = ConfigDraft.resolve(entries)
    after.policies?.push({ action: "provider.use", resource: "other", effect: "deny" })

    const projected = ConfigDraft.project(entries, before, after)

    expect(ManagedPolicy.decision(ManagedPolicy.statements(projected), "provider.use", "proxy")).toBe("allow")
    expect(ManagedPolicy.decision(ManagedPolicy.statements(projected), "provider.use", "other")).toBe("deny")
  })

  test("keeps configured instruction and skill paths unique after adding paths in a callback", () => {
    const entries = [
      document({ skills: ["./skills"], instructions: ["./instructions"] }),
      document({ skills: ["./skills"], instructions: ["./instructions"] }),
    ]
    const before = ConfigDraft.resolve(entries)
    const after = ConfigDraft.resolve(entries)
    after.skills?.push("./added-skills")
    after.instructions?.push("./added-instructions")

    const projected = ConfigDraft.apply(ConfigDraft.project(entries, before, after))

    expect(ConfigDraft.resolve(projected).skills).toEqual(["./skills", "./added-skills"])
    expect(projected.flatMap((entry) => (entry.type === "document" ? (entry.info.instructions ?? []) : []))).toEqual([
      "./instructions",
      "./added-instructions",
    ])
  })
})
