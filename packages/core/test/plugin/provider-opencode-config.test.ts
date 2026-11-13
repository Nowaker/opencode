import { expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { ConfigIntegration } from "@opencode/core/config/integration"
import { Credential } from "@opencode/core/credential"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Flag } from "@opencode/core/flag"
import { InstructionDiscovery } from "@opencode/core/instruction-discovery"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { Plugin } from "@opencode/core/plugin"
import { OpencodePlugin } from "@opencode/core/plugin/provider/opencode"
import { OpencodeWatches } from "@opencode/core/plugin/provider/opencode-watches"
import { Provider } from "@opencode/core/provider"
import { SharedCache } from "@opencode/core/shared-cache"
import { Skill } from "@opencode/core/skill"
import { Tool } from "@opencode/core/tool"
import { Event } from "@opencode/schema/config"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { LayerNodePlatform } from "@opencode/util/effect/app-node-platform"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpClient } from "effect/http"
import { tempLocationLayer } from "../fixture/location"
import { emptyMcpLayer } from "../fixture/mcp"
import { offlineModels } from "../fixture/models"
import { testEffect } from "../lib/effect"
import { eventually, waitUntil } from "../lib/eventually"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Plugin.node,
      Bus.node,
      Config.node,
      Credential.node,
      Provider.node,
      InstructionDiscovery.node,
      SharedCache.node,
      Skill.node,
      Tool.node,
      Flag.node,
      LayerNodePlatform.httpClient,
    ]),
    [
      Config.node.replace(Config.configured({ global: false, project: false, system: false })),
      Location.node.replace(tempLocationLayer),
      Mcp.node.replace(emptyMcpLayer),
      offlineModels,
    ],
  ).pipe(Layer.provide(Layer.succeed(Flag.Overrides, "console_watches"))),
)

const integrationID = Integration.ID.make("opencode")
const remote = (name: string) =>
  Schema.decodeUnknownSync(ConfigIntegration.Remote)({
    providers: {
      console: {
        name,
        package: "@opencode/ai/providers/openai-compatible",
        models: { chat: { limit: { context: 8192, output: 512 } } },
      },
    },
  })

const consoleFixture = Effect.fnUntraced(function* () {
  const state = { name: "First", watches: true, requests: 0 }
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: (request, server) => {
          const path = new URL(request.url).pathname
          if (path === "/api/v2/config") {
            state.requests++
            return Response.json(remote(state.name), {
              headers: state.watches ? { [OpencodeWatches.header]: "1" } : {},
            })
          }
          if (path === "/api/v2/instructions")
            return Response.json({ instructions: [{ id: "style", content: state.name }] })
          if (path === "/api/v2/skills")
            return Response.json({ skills: [{ slug: state.name.toLowerCase(), version: "1" }] })
          if (path.startsWith("/api/v2/skills/")) {
            const slug = path.slice("/api/v2/skills/".length)
            return Response.json({
              slug,
              files: [{ path: "SKILL.md", content: `---\nname: ${slug}\ndescription: ${slug} skill\n---\nContent` }],
            })
          }
          if (path === "/api/event-watches/stream" && server.upgrade(request, { data: undefined })) return
          return new Response(null, { status: 404 })
        },
        websocket: {
          open: (socket) => {
            socket.send(JSON.stringify({ type: "snapshot", events: [] }))
          },
          message: () => {},
        },
      }),
    ),
    (server) => Effect.promise(() => server.stop(true)),
  )
  const plugins = yield* Plugin.Service
  yield* Effect.addFinalizer(plugins.close)
  const credentials = yield* Credential.Service
  const connect = () =>
    credentials.create({
      integrationID,
      value: Credential.Key.make({ type: "key", key: "fixture", metadata: { server: server.url.origin } }),
    })
  const initial = yield* connect()
  const config = yield* Config.Service
  if (!config.configuration || !config.integration) return yield* Effect.die("real configuration boundary missing")
  const context = Context.pick(
    Bus.Service,
    Config.Service,
    Flag.Service,
    InstructionDiscovery.Service,
    SharedCache.Service,
    Skill.Service,
    HttpClient.HttpClient,
  )(yield* Effect.context<Effect.Services<ReturnType<typeof OpencodePlugin.effect>>>())
  const generation: Plugin.Generation = {
    ...OpencodePlugin,
    revision: "1",
    effect: (host) => OpencodePlugin.effect(host).pipe(Effect.provide(context)),
  }
  return {
    state,
    plugins,
    config,
    generation,
    configuration: config.configuration,
    integrate: config.integration,
    initial,
    connect,
  }
})

const resources = Effect.gen(function* () {
  const discovery = yield* InstructionDiscovery.Service
  const skills = yield* Skill.Service
  const tools = yield* Tool.Service
  const instructions = yield* discovery.list()
  return {
    instructions: Array.isArray(instructions) ? instructions.map((file) => file.content) : instructions,
    skills: (yield* skills.list()).map((skill) => skill.id).toSorted(),
    watches: (yield* tools.list()).some((tool) => tool.options?.namespace === "console_watch"),
  }
})

it.live("loads Console providers and resources at the initial managed configuration commit", () =>
  Effect.gen(function* () {
    const fixture = yield* consoleFixture()
    const providers = yield* Provider.Service
    yield* fixture.configuration.manage
    yield* fixture.plugins.activate([fixture.generation])
    expect((yield* fixture.plugins.list())[0]?.state).toEqual({ status: "active" })
    expect(yield* providers.get(Provider.ID.make("console"))).toMatchObject({ name: "First" })
    yield* eventually(resources, (value) => value.skills.includes(Skill.ID.make("first")))
    expect(yield* resources).toEqual({ instructions: ["First"], skills: [Skill.ID.make("first")], watches: true })
    const bus = yield* Bus.Service
    const folds = { count: 0 }
    yield* providers.transform(() => folds.count++)
    yield* providers.get(Provider.ID.make("console"))
    const before = folds.count
    yield* bus.publish(Event.Updated, {})
    yield* eventually(
      providers.get(Provider.ID.make("console")).pipe(Effect.map(() => folds.count)),
      (count) => count > before,
    )
    expect(fixture.state.requests).toBe(1)
  }),
)

it.live("keeps Console resources enabled when a configuration callback edits its provider", () =>
  Effect.gen(function* () {
    const fixture = yield* consoleFixture()
    const providers = yield* Provider.Service
    yield* fixture.configuration.manage
    yield* fixture.plugins.activate([
      fixture.generation,
      {
        id: "console-provider-edit",
        revision: "1",
        effect: (ctx) =>
          ctx.config
            .configure((draft) =>
              Effect.sync(() => {
                const provider = draft.providers?.console
                if (!provider) throw new Error("Console provider missing from loaded draft")
                provider.name = "Edited"
              }),
            )
            .pipe(Effect.asVoid),
      },
    ])

    expect((yield* providers.get(Provider.ID.make("console")))?.name).toBe("Edited")
    expect((yield* resources).instructions).toEqual(["First"])
    yield* eventually(resources, (value) => value.skills.includes(Skill.ID.make("first")))
    expect(yield* resources).toEqual({ instructions: ["First"], skills: [Skill.ID.make("first")], watches: true })
  }),
)

it.live("replaces the committed Console document after a connection switch in managed configuration", () =>
  Effect.gen(function* () {
    const fixture = yield* consoleFixture()
    const providers = yield* Provider.Service
    // Seed the prior committed document so this path reaches replacement even before the startup fix.
    yield* fixture.integrate(
      integrationID,
      ConfigIntegration.make({
        integrationID,
        connection: { type: "credential", id: fixture.initial.id, label: fixture.initial.label, method: "key" },
        info: remote("First"),
      }),
    )
    yield* fixture.configuration.manage
    yield* fixture.plugins.activate([fixture.generation])
    expect((yield* fixture.plugins.list())[0]?.state).toEqual({ status: "active" })
    yield* eventually(resources, (value) => value.skills.includes(Skill.ID.make("first")))
    expect(yield* providers.get(Provider.ID.make("console"))).toMatchObject({ name: "First" })

    fixture.state.name = "Second"
    fixture.state.watches = false
    const replacement = yield* fixture.connect()
    yield* waitUntil(
      fixture.configuration
        .entries()
        .pipe(
          Effect.map((entries) =>
            entries.some(
              (entry) =>
                entry instanceof ConfigIntegration.Document &&
                entry.connection.type === "credential" &&
                entry.connection.id === replacement.id,
            ),
          ),
        ),
    )
    yield* fixture.plugins.activate([fixture.generation])
    expect(yield* providers.get(Provider.ID.make("console"))).toMatchObject({ name: "Second" })
    expect((yield* providers.snapshot()).available.find((record) => record.provider.id === "console")).toMatchObject({
      sourceConnection: { type: "credential", id: replacement.id },
    })
    yield* eventually(resources, (value) => value.skills.includes(Skill.ID.make("second")))
    expect(yield* resources).toEqual({ instructions: ["Second"], skills: [Skill.ID.make("second")], watches: false })
    expect(fixture.state.requests).toBe(2)
  }),
)
