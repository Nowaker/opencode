import { expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Deferred, Effect, Schema } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session/session"
import { provideTmpdirInstance } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      SessionPrompt.node,
      Session.node,
      SessionProjector.node,
      EventV2Bridge.node,
      Ripgrep.node,
      CrossSpawnSpawner.node,
    ]),
    [[RuntimeFlags.node, RuntimeFlags.layer({ pure: true, disableDefaultPlugins: true, experimentalEventSystem: true })]],
  ),
)

const requestBody = Schema.Struct({ model: Schema.String, temperature: Schema.optional(Schema.Number) })
const generatedTitle = "Repair automatic session titles"

function response(model: string, text: string) {
  const content = { type: "output_text", text, annotations: [], logprobs: [] }
  const item = { id: "msg_title_fixture", type: "message", role: "assistant", status: "completed", content: [content] }
  const result = {
    id: "resp_title_fixture",
    object: "response",
    created_at: 1,
    model,
    status: "completed",
    error: null,
    incomplete_details: null,
    output: [item],
    usage: {
      input_tokens: 8,
      output_tokens: 5,
      total_tokens: 13,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  }
  const events = [
    { type: "response.created", response: { ...result, status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
    { type: "response.content_part.added", item_id: item.id, output_index: 0, content_index: 0, part: { ...content, text: "" } },
    { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: text, logprobs: [] },
    { type: "response.output_text.done", item_id: item.id, output_index: 0, content_index: 0, text, logprobs: [] },
    { type: "response.content_part.done", item_id: item.id, output_index: 0, content_index: 0, part: content },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: result },
  ]
  return new Response(
    events.map((event, index) => `data: ${JSON.stringify({ ...event, sequence_number: index + 1 })}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  )
}

for (const providerID of ["openai-meridian", "openai2"] as const) {
  it.live(
    providerID === "openai-meridian"
      ? "persists the automatic Luna title when the gateway rejects temperature despite its catalog claiming support"
      : "persists the automatic title while preserving sampling on a direct OpenAI transport",
    () =>
      Effect.gen(function* () {
        const settled = yield* Deferred.make<string>()
        const titles: { model: string; temperature: number | undefined; status: number }[] = []
        const modelLists: string[] = []
        const gateway = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              hostname: "127.0.0.1",
              port: 0,
              async fetch(request) {
                const pathname = new URL(request.url).pathname
                if (request.method === "GET" && pathname === "/v1/models") {
                  modelLists.push(pathname)
                  return Response.json({ object: "list", data: [{ id: "gpt-6-luna" }, { id: "gpt-6-sol" }] })
                }
                if (request.method !== "POST" || pathname !== "/v1/responses") {
                  return new Response("unexpected provider route", { status: 404 })
                }
                const body = Schema.decodeUnknownSync(requestBody)(await request.json())
                if (body.model === "gpt-6-luna") {
                  const rejected = providerID === "openai-meridian" && body.temperature !== undefined
                  titles.push({ model: body.model, temperature: body.temperature, status: rejected ? 400 : 200 })
                  if (rejected) {
                    const message = "Unsupported parameter: temperature"
                    Deferred.doneUnsafe(settled, Effect.succeed(message))
                    return Response.json(
                      { error: { message, type: "invalid_request_error", param: "temperature", code: "unsupported_parameter" } },
                      { status: 400 },
                    )
                  }
                  return response(body.model, generatedTitle)
                }
                return response(body.model, "Main response completed")
              },
            }),
          ),
          (server) => Effect.promise(() => server.stop(true)),
        )

        yield* provideTmpdirInstance(
          () =>
            Effect.gen(function* () {
              const sessions = yield* Session.Service
              const prompt = yield* SessionPrompt.Service
              const events = yield* EventV2Bridge.Service
              const session = yield* sessions.create({})
              yield* Effect.addFinalizer(() => sessions.remove(session.id).pipe(Effect.orDie))
              const off = yield* events.listen((event) => {
                if (event.type !== Session.Event.Updated.type) return Effect.void
                const data = Schema.decodeUnknownSync(
                  Schema.Struct({ sessionID: Schema.String, info: Schema.Struct({ title: Schema.String }) }),
                )(event.data)
                if (data.sessionID !== session.id || data.info.title !== generatedTitle) return Effect.void
                return Deferred.succeed(settled, "title persisted").pipe(Effect.asVoid)
              })
              yield* Effect.addFinalizer(() => off)

              const result = yield* prompt.prompt({
                sessionID: session.id,
                parts: [{ type: "text", text: "Repair the automatic session title generation." }],
              })
              expect(result.info.role).toBe("assistant")
              expect(result.parts.filter((part) => part.type === "text").map((part) => part.text)).toEqual([
                "Main response completed",
              ])
              const outcome = yield* awaitWithTimeout(
                Deferred.await(settled),
                "title generation neither persisted a title nor reached the provider rejection",
                "5 seconds",
              )
              const persisted = yield* sessions.get(session.id)
              expect(persisted.title, `${outcome}; title requests: ${JSON.stringify(titles)}`).toBe(generatedTitle)
              expect(titles).toEqual([
                { model: "gpt-6-luna", temperature: providerID === "openai2" ? 0.5 : undefined, status: 200 },
              ])
              expect(modelLists).toEqual(providerID === "openai-meridian" ? ["/v1/models"] : [])
            }),
          {
            config: {
              model: `${providerID}/gpt-6-sol`,
              small_model: `${providerID}/gpt-6-luna`,
              snapshot: false,
              lsp: false,
              provider: {
                [providerID]: {
                  npm: "@ai-sdk/openai",
                  options: { apiKey: "fixture-key", baseURL: new URL("/v1", gateway.url).href },
                  whitelist: ["gpt-6-luna", "gpt-6-sol"],
                  models: {
                    "gpt-6-luna": {
                      temperature: true,
                      options: { reasoningEffort: "none" },
                      limit: { context: 100000, output: 10000 },
                    },
                    "gpt-6-sol": { temperature: true, limit: { context: 100000, output: 10000 } },
                  },
                },
              },
            },
          },
        )
      }),
    30_000,
  )
}
