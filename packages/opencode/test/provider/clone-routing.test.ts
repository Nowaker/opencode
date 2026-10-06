import { afterAll, afterEach, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Env } from "../../src/env"
import { Plugin } from "../../src/plugin"
import { Provider } from "../../src/provider/provider"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const requests: { path: string; model: string; credential: string | null }[] = []
const gateway = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const pathname = new URL(request.url).pathname
    if (request.method === "GET") return Response.json({ data: [{ id: "gpt-5.6-sol" }] })
    const body = Schema.decodeUnknownSync(Schema.Struct({ model: Schema.String }))(await request.json())
    requests.push({
      path: pathname,
      model: body.model,
      credential: request.headers.get("x-api-key") ?? request.headers.get("authorization"),
    })
    if (pathname.endsWith("/messages")) {
      return Response.json({
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "text", text: "gateway-answer" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      })
    }
    return Response.json({
      id: "resp_fixture",
      created_at: 1,
      model: body.model,
      output: [
        {
          type: "message",
          id: "msg_fixture",
          role: "assistant",
          content: [{ type: "output_text", text: "gateway-answer", annotations: [] }],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    })
  },
})

afterAll(() => gateway.stop(true))
afterEach(async () => {
  requests.length = 0
  await disposeAllInstances()
})

const it = testEffect(
  LayerNode.compile(LayerNode.group([Provider.node, Env.node, Plugin.node, RuntimeFlags.node]), [
    [RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true, pure: true })],
  ]),
)

for (const item of [
  { source: "anthropic", clone: "anthropic2", model: "claude-sonnet-4-6", endpoint: "messages" },
  { source: "openai", clone: "openai2", model: "gpt-5.6-sol", endpoint: "responses" },
  { source: "openai", clone: "openai-meridian", model: "gpt-5.6-sol", endpoint: "responses" },
] as const) {
  it.instance(
    `${item.clone} sends generation to its own baseURL without changing ${item.source}'s route`,
    Effect.gen(function* () {
      const provider = yield* Provider.Service
      for (const id of [item.source, item.clone]) {
        const model = yield* provider.getModel(
          ProviderV2.ID.make(id),
          ModelV2.ID.make(id === "openai-meridian" ? `${item.model}-fast` : item.model),
        )
        const language = yield* provider.getLanguage(model)
        const result = yield* Effect.promise(() =>
          language.doGenerate({
            prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
            maxOutputTokens: 16,
            abortSignal: AbortSignal.timeout(2000),
          }),
        )
        expect(result.content).toContainEqual(expect.objectContaining({ type: "text", text: "gateway-answer" }))
      }

      expect(requests).toEqual([
        {
          path: `/source/v1/${item.endpoint}`,
          model: item.model,
          credential: item.source === "anthropic" ? "fixture-source" : "Bearer fixture-source",
        },
        {
          path: `/clone/v1/${item.endpoint}`,
          model: item.model,
          credential: item.source === "anthropic" ? "fixture-clone" : "Bearer fixture-clone",
        },
      ])
    }),
    {
      config: {
        provider: {
          [item.source]: { options: { apiKey: "fixture-source", baseURL: new URL("/source/v1", gateway.url).href } },
          [item.clone]: { options: { apiKey: "fixture-clone", baseURL: new URL("/clone/v1", gateway.url).href } },
        },
      },
    },
    15000,
  )
}
