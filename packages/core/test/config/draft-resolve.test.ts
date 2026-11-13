import { describe, expect, test } from "bun:test"
import { ConfigDraft } from "@opencode/core/config/draft"
import { Config } from "@opencode/schema/config"
import { Model } from "@opencode/schema/model"
import { Permission } from "@opencode/schema/permission"
import { Provider } from "@opencode/schema/provider"
import { AbsolutePath } from "@opencode/schema/schema"
import { Schema } from "effect"

const decode = Schema.decodeUnknownSync(Config.Info)
const document = (info: unknown) => new Config.Document({ type: "document", info: decode(info) })

describe("ConfigDraft.resolve", () => {
  test("folds loaded provider overlays without introducing catalog defaults", () => {
    const draft = ConfigDraft.resolve([
      document({
        providers: {
          proxy: {
            env: ["OLD_KEY", "OTHER_KEY"],
            settings: { baseURL: "https://proxy.example/v1", nested: { keep: 1, list: [1, 2] } },
            headers: { "X-Route": "old", "X-Keep": "keep" },
          },
        },
      }),
      new Config.Directory({ type: "directory", path: AbsolutePath.make("/discovery") }),
      document({
        providers: {
          proxy: {
            name: "Proxy",
            env: ["NEW_KEY"],
            settings: { nested: { list: [3] } },
            headers: { "x-route": "new" },
          },
        },
      }),
    ])

    expect(draft.providers).toEqual({
      proxy: {
        name: "Proxy",
        env: ["NEW_KEY"],
        settings: { baseURL: "https://proxy.example/v1", nested: { keep: 1, list: [3] } },
        headers: { "x-route": "new", "X-Keep": "keep" },
      },
    })
    expect(ConfigDraft.resolve([])).toEqual({})
  })

  test("concatenates global and agent permissions into an independent mutable draft", () => {
    const allow = { action: "read", resource: "one", effect: "allow" } satisfies Permission.Rule
    const deny = { action: "read", resource: "two", effect: "deny" } satisfies Permission.Rule
    const entries = [
      document({ permissions: [allow], agents: { review: { permissions: [allow], system: "first" } } }),
      document({ permissions: [deny], agents: { review: { permissions: [deny], system: "second" } } }),
    ]
    const draft = ConfigDraft.resolve(entries)

    expect(draft.permissions).toEqual([allow, deny])
    expect(draft.agents?.review).toEqual({ permissions: [allow, deny], system: "second" })
    draft.permissions?.pop()
    draft.agents?.review.permissions?.pop()
    expect(entries[1].info.permissions).toEqual([deny])
    expect(entries[1].info.agents?.review.permissions).toEqual([deny])
  })

  test("replaces commands, references, selections and MCP servers at their consumer boundaries", () => {
    const draft = ConfigDraft.resolve([
      document({
        commands: { review: { template: "old", description: "old description" } },
        references: { docs: { path: "./old", description: "old description" } },
        model: "provider/old#high",
        mcp: {
          timeout: { catalog: 100 },
          servers: { service: { type: "local", command: ["old"], env: { OLD: "1" } } },
        },
      }),
      document({
        commands: { review: { template: "new" } },
        references: { docs: "./new" },
        model: "provider/new",
        mcp: { timeout: { execution: 200 }, servers: { service: { type: "local", command: ["new"] } } },
      }),
    ])

    expect(draft.commands?.review).toEqual({ template: "new" })
    expect(draft.references?.docs).toBe("./new")
    expect(draft.model).toEqual({ providerID: Provider.ID.make("provider"), model: Model.ID.make("new") })
    expect(draft.mcp).toEqual({
      timeout: { catalog: 100, execution: 200 },
      servers: { service: { type: "local", command: ["new"] } },
    })
  })

  test("uses formatter booleans as resets and formatter arrays as replacements", () => {
    const draft = ConfigDraft.resolve([
      document({ formatter: { removed: { command: ["old"] } } }),
      document({ formatter: false }),
      document({
        formatter: {
          custom: { command: ["first"], extensions: [".one", ".two"], environment: { KEEP: "1" } },
        },
      }),
      document({
        formatter: { custom: { command: ["last"], extensions: [".last"], environment: { EXTRA: "2" } } },
      }),
    ])

    expect(draft.formatter).toEqual({
      custom: { command: ["last"], extensions: [".last"], environment: { KEEP: "1", EXTRA: "2" } },
    })
    expect(ConfigDraft.resolve([document({ formatter: {} }), document({ formatter: true })]).formatter).toBe(true)
  })

  test("resets disabled agent definitions and merges request body members shallowly", () => {
    const draft = ConfigDraft.resolve([
      document({ agents: { review: { system: "old", request: { body: { nested: { old: true } } } } } }),
      document({ agents: { review: { disabled: true } } }),
      document({ agents: { review: { request: { body: { nested: { first: true }, keep: true } } } } }),
      document({ agents: { review: { request: { body: { nested: { last: true } } } } } }),
    ])

    expect(draft.agents?.review).toEqual({ request: { body: { nested: { last: true }, keep: true } } })
  })
})
