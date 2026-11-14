import { expect } from "bun:test"
import { AIClient, LLMClient, Message } from "@opencode/ai/effect"
import { OpenAI } from "@opencode/ai/providers"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Project } from "@opencode/core/project"
import { SessionModelRequest } from "@opencode/core/session/model-request"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { Money } from "@opencode/schema/money"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { DateTime, Effect, Schema } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Agent.node, PluginHooks.node, SessionModelRequest.node])))
const agentID = Agent.ID.make("request-defaults")
const session = Session.Info.make({
  id: Session.ID.make("ses_agent_request"),
  projectID: Project.ID.global,
  cost: Money.USD.zero,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
  location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
})
const kinds = [
  { kind: "primary", hook: "context" },
  { kind: "compaction", hook: "compaction" },
  { kind: "generate", hook: "generate" },
  { kind: "title", hook: "title" },
] as const
const settings = {
  temperature: 0.73,
  maxTokens: 1234,
  topP: 0.82,
  topK: 17,
  frequencyPenalty: 0.15,
  presencePenalty: 0.25,
  seed: 42,
  stop: ["stop-agent"],
  reasoningEffort: "medium",
}
const wire = Schema.Struct({
  temperature: Schema.Number,
  top_p: Schema.optional(Schema.Number),
  max_completion_tokens: Schema.optional(Schema.Number),
  reasoning_effort: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})

for (const entry of kinds) {
  for (const mode of ["agent", "hook", "body", "absent"] as const) {
    it.live(`${entry.kind} sends ${mode} generation defaults through the native provider request`, () =>
      Effect.gen(function* () {
        const received: Array<{ body: typeof wire.Type; header: string | null }> = []
        const server = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              hostname: "127.0.0.1",
              port: 0,
              fetch: async (request) => {
                received.push({
                  body: Schema.decodeUnknownSync(wire)(await request.json()),
                  header: request.headers.get("x-agent-source"),
                })
                return new Response(
                  `data: ${JSON.stringify({
                    id: "chatcmpl-agent",
                    object: "chat.completion.chunk",
                    choices: [{ index: 0, delta: { role: "assistant", content: "done" }, finish_reason: "stop" }],
                  })}\n\ndata: [DONE]\n\n`,
                  { headers: { "content-type": "text/event-stream" } },
                )
              },
            }),
          ),
          (server) => Effect.promise(() => server.stop(true)),
        )
        const agents = yield* Agent.Service
        yield* agents.transform((editor) => {
          editor.update(agentID, (agent) => {
            if (mode === "absent") return
            agent.request = {
              settings: structuredClone(settings),
              headers: { "x-agent-source": "agent" },
              body: {
                metadata: { shared: "agent", agent: "kept" },
                ...(mode === "body" ? { temperature: 0.44 } : {}),
              },
            }
          })
          editor.update(Agent.defaultID, (agent) => {
            agent.request.settings.temperature = 0.91
          })
        })
        const hooks = yield* PluginHooks.Service
        if (mode === "hook") {
          yield* hooks.register("session", entry.hook, (event) =>
            Effect.sync(() => {
              expect(event.options).toMatchObject(settings)
              event.options.temperature = 0.29
              event.options.stop?.push("hook-stop")
            }),
          )
          yield* hooks.register("session", "model.request", (event) =>
            Effect.sync(() => {
              expect(event.headers["x-agent-source"]).toBe("agent")
              event.headers["x-agent-source"] = "hook"
            }),
          )
        }
        const requests = yield* SessionModelRequest.Service
        const prepared = yield* requests[entry.kind]({
          session,
          agent: agentID,
          model: SessionRunnerModel.resolved(
            OpenAI.configure({
              apiKey: false,
              baseURL: server.url.href,
              temperature: 1,
              headers: { "x-agent-source": "provider" },
              http: { body: { metadata: { shared: "provider", provider: "kept" } } },
            }).chat("gpt-4.1"),
            {
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              cost: [],
              limit: { context: 200_000, output: 32_000 },
            },
          ),
          system: [],
          messages: [Message.user("Hello")],
        })
        const response = yield* LLMClient.generate(prepared.request, prepared.options).pipe(
          Effect.provide(AIClient.layer),
        )
        expect(response.text).toBe("done")
        expect(received).toEqual([
          {
            body: {
              temperature: mode === "absent" ? 1 : mode === "hook" ? 0.29 : mode === "body" ? 0.44 : 0.73,
              ...(mode === "absent"
                ? entry.kind === "primary" || entry.kind === "compaction"
                  ? { max_completion_tokens: 32_000 }
                  : {}
                : { top_p: 0.82, max_completion_tokens: 1234, reasoning_effort: "medium" }),
              metadata:
                mode === "absent"
                  ? { shared: "provider", provider: "kept" }
                  : { shared: "agent", provider: "kept", agent: "kept" },
            },
            header: mode === "absent" ? "provider" : mode === "hook" ? "hook" : "agent",
          },
        ])
        if (mode !== "absent") {
          const { reasoningEffort, ...generation } = settings
          expect(prepared.request).toMatchObject({
            ...generation,
            temperature: mode === "hook" ? 0.29 : 0.73,
            stop: mode === "hook" ? ["stop-agent", "hook-stop"] : settings.stop,
          })
          expect(prepared.request.providerOptions).toEqual({ reasoningEffort })
        }
        expect((yield* agents.get(agentID))?.request.settings).toEqual(mode === "absent" ? {} : settings)
      }),
    )
  }
}
