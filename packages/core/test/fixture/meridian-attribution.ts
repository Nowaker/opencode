import { LLMClient, Message } from "@opencode/ai/effect"
import { OpenAI } from "@opencode/ai/providers"
import { AnthropicCompatible } from "@opencode/ai/providers/anthropic-compatible"
import { Agent } from "@opencode/core/agent"
import { App } from "@opencode/core/app"
import { llmClient } from "@opencode/core/effect/app-node-platform"
import { Generate } from "@opencode/core/generate"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionModelRequest } from "@opencode/core/session/model-request"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { Money } from "@opencode/schema/money"
import { Session } from "@opencode/schema/session"
import { fetchLayer, httpFetch } from "@opencode/util/effect/app-node-platform"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { DateTime, Effect, Layer } from "effect"

const [origin, mode, version] = process.argv.slice(2)
if (!origin || !version) throw new Error("Missing attribution fixture arguments")

const ordinaryBase = new URL("/trusted/v1", origin).href
const routedBase = new URL("/direct/v1", origin).href
const proxy = OpenAI.configure({ baseURL: ordinaryBase, apiKey: false, headers: { "x-meridian-source": "legacy" } })
const session = Session.Info.make({
  id: Session.ID.make("ses_fixture"),
  projectID: Project.ID.global,
  cost: Money.USD.zero,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
  location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
})
const model = SessionRunnerModel.resolved(proxy.chat("fixture"), {
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  cost: [],
  limit: { context: 200_000, output: 32_000 },
})
let customFetchCalls = 0
const customFetch = Object.assign(
  (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    customFetchCalls++
    return fetch(url, init)
  },
  { preconnect: fetch.preconnect },
)
const layer = LayerNode.compile(
  LayerNode.group([PluginHooks.node, SessionModelRequest.node, llmClient, Generate.node]),
  {
    replacements: [
      App.node.replace(App.configured({ version })),
      Agent.node.replace(Layer.mock(Agent.Service, { get: () => Effect.undefined })),
      ModelResolver.node.replace(Layer.mock(ModelResolver.Service, { resolve: () => Effect.succeed(model) })),
      Model.node.replace(Layer.mock(Model.Service, {})),
      ...(mode === "custom-host-fetch" ? [httpFetch.replace(fetchLayer(customFetch))] : []),
    ],
  },
)

await Effect.runPromise(
  Effect.gen(function* () {
    const requests = yield* SessionModelRequest.Service
    const llm = yield* LLMClient.Service
    const hooks = yield* PluginHooks.Service
    const generate = yield* Generate.Service
    const input = { session, model, agent: Agent.ID.make("build"), system: [], messages: [Message.user("Naming task")] }

    yield* hooks.register("session", "http.request", (event) =>
      Effect.sync(() => {
        if (event.request.headers.has("x-meridian-purpose"))
          throw new Error("Producer attribution appeared inside a hook")
        if (mode === "hook-rewrite") {
          const url = new URL("/direct/v1/chat/completions", origin)
          event.request = new Request(url.href, event.request)
          return
        }
        if (mode === "tagged-calls") {
          event.request.headers.set("x-meridian-client", "stale")
          event.request.headers.set("x-meridian-purpose", "stale")
          event.request.headers.set("x-meridian-session", "stale")
        }
      }),
    )

    if (mode === "tagged-calls") {
      for (const prepared of [
        yield* requests.primary(input),
        yield* requests.title(input),
        yield* requests.compaction(input),
        yield* requests.primary({
          ...input,
          session: { ...session, id: Session.ID.make("ses_child"), parentID: session.id },
        }),
        yield* requests.generate(input),
      ]) {
        yield* llm.generate(prepared.request, prepared.options)
      }
      yield* generate.text({ prompt: "Stateless helper" })
      return
    }

    const baseURL =
      mode === "direct" ? routedBase : mode?.endsWith("redirect") ? new URL(`/${mode}/v1`, origin).href : ordinaryBase
    const selected = OpenAI.configure({ baseURL, apiKey: false })
    if (mode === "websocket" || mode === "websocket-fallback") {
      const responses =
        mode === "websocket-fallback"
          ? OpenAI.configure({ baseURL: new URL("/ws-fallback/v1", origin).href, apiKey: false }).responses("fixture")
          : selected.responses("fixture")
      const prepared = yield* requests.primary({
        ...input,
        model: { ...model, model: responses, transport: "websocket" },
        webSocket: "session",
      })
      yield* llm.generate(prepared.request, prepared.options)
      return
    }
    if (mode === "messages" || mode === "bare-messages") {
      // A Meridian base without /v1 makes the Messages route post to a bare /messages path.
      const baseURL = mode === "bare-messages" ? new URL(origin).origin : ordinaryBase
      const messages = AnthropicCompatible.configure({ provider: "meridian", baseURL, apiKey: false })
      const prepared = yield* requests.primary({ ...input, model: { ...model, model: messages.model("fixture") } })
      const reply = yield* llm.generate(prepared.request, prepared.options)
      if (reply.text !== "OK") throw new Error("Messages fixture did not complete the model call")
      return
    }
    if (mode === "trigger" || mode === "endpoint") {
      const responses = selected.responses("fixture")
      const prepared = yield* requests.compaction({ ...input, model: { ...model, model: responses } })
      const request = { ...prepared.request, model: responses }
      if (mode === "trigger") yield* llm.compact(request, { ...prepared.options, mechanism: "trigger" })
      if (mode === "endpoint") yield* llm.compact(request, { mechanism: "endpoint", http: prepared.options.http })
      return
    }
    const prepared = yield* requests.primary({ ...input, model: { ...model, model: selected.chat("fixture") } })
    const request = mode === "custom-request-fetch" ? { ...prepared.request, fetch: customFetch } : prepared.request
    const result = llm.generate(request, prepared.options)
    if (mode === "trusted-redirect") {
      const error = yield* Effect.flip(result)
      if (error.reason._tag !== "Transport") throw new Error(`Expected transport error, got ${error.reason._tag}`)
      return
    }
    const reply = yield* result
    if (reply.text !== "OK") throw new Error("Fixture did not complete the model call")
    if ((mode === "custom-request-fetch" || mode === "custom-host-fetch") && customFetchCalls !== 1)
      throw new Error(`Expected one call through the custom fetch, got ${customFetchCalls}`)
  }).pipe(Effect.scoped, Effect.provide(layer)),
)
