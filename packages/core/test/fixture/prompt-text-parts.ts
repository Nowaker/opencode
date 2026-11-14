import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionTransfer } from "@opencode/core/session/transfer"
import { Snapshot } from "@opencode/core/snapshot"
import { AbsolutePath } from "@opencode/schema/schema"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Schema } from "effect"
import { testEffect } from "../lib/effect"
import { offlineModels } from "./models"
import { tmpdirScoped } from "./tmpdir"

export const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Session.node,
      SessionExecution.node,
      SessionTransfer.node,
      LocationServiceMap.node,
      Bus.node,
    ]),
    [
      offlineModels,
      Bus.node.replace(Bus.configured({ persist: true })),
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      Snapshot.node.replace(Snapshot.noopLayer),
    ],
  ),
)

export const setup = Effect.gen(function* () {
  const received: string[] = []
  const kinds: string[] = []
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          received.push(await request.text())
          kinds.push(request.headers.get("x-parts-kind") ?? "missing")
          return new Response(
            `data: ${JSON.stringify({
              id: "chatcmpl-parts",
              object: "chat.completion.chunk",
              choices: [
                {
                  index: 0,
                  delta: {
                    role: "assistant",
                    content:
                      request.headers.get("x-parts-kind") === "compaction"
                        ? "## Objective\nNative summary"
                        : "Native answer",
                  },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
            })}\n\ndata: [DONE]\n\n`,
            { headers: { "content-type": "text/event-stream" } },
          )
        },
      }),
    ),
    (server) => Effect.promise(() => server.stop(true)),
  )
  const dir = yield* tmpdirScoped()
  yield* Effect.promise(() =>
    Bun.write(
      `${dir.path}/opencode.json`,
      JSON.stringify({
        model: { providerID: "parts", id: "parts" },
        providers: {
          parts: {
            package: "@opencode/ai/providers/openai-compatible",
            settings: { apiKey: "fixture", baseURL: server.url.href },
            models: {
              parts: {
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                limit: { context: 200000, output: 1000 },
              },
            },
          },
        },
        compaction: { auto: false, keep: { tokens: 1000 } },
        warming: false,
      }),
    ),
  )
  const sessions = yield* Session.Service
  const session = yield* sessions.create({
    location: { directory: AbsolutePath.make(dir.path) },
    model: { providerID: Provider.ID.make("parts"), id: Model.ID.make("parts") },
    title: "Parts",
  })
  const locations = yield* LocationServiceMap.Service
  const layer = locations.get(session.location)
  yield* Plugin.awaitActivation.pipe(Effect.provide(layer))
  const hooks = yield* PluginHooks.Service.pipe(Effect.provide(layer))
  yield* hooks.register("session", "http.request", (event) =>
    Effect.sync(() => {
      event.request.headers.set("x-parts-kind", event.kind)
    }),
  )
  return { sessions, session, hooks, layer, received, kinds, db: (yield* Database.Service).db }
})

export const decodeBody = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      messages: Schema.Array(Schema.Struct({ role: Schema.String, content: Schema.Unknown })),
    }),
  ),
)
