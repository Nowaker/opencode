import { Cause, Context, Deferred, Effect, Layer, Queue, Stream } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { LLMEvent } from "@opencode-ai/llm"
import { Provider } from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { LLM } from "@/session/llm"
import { LiveEvents } from "@/session/live-events"
import { Session } from "@/session/session"
import { SessionProcessor } from "@/session/processor"
import { SessionSummary } from "@/session/summary"
import { Snapshot } from "@/snapshot"
import { MessageID, type SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

type Item = { result: Effect.Effect<LLMEvent, Error>; done: Deferred.Deferred<void> }
type Source = () => readonly SessionV1.Part[]
export class Feed extends Context.Service<Feed, {
  stream: Stream.Stream<LLMEvent, Error>
  send: (event: LLMEvent) => Effect.Effect<void>
  fail: (error: Error) => Effect.Effect<void>
  end: Effect.Effect<boolean>
  sources: Set<Source>
  beforeGuard: (() => Effect.Effect<void>) | undefined
}>()("test/LiveFeed") {}
const feed = LayerNode.make({ service: Feed, deps: [], layer: Layer.effect(Feed, Effect.gen(function* () {
  const queue = yield* Queue.unbounded<Item, Cause.Done>()
  const send = (result: Effect.Effect<LLMEvent, Error>) => Effect.gen(function* () {
    const done = yield* Deferred.make<void>()
    yield* Queue.offer(queue, { result, done })
    yield* Deferred.await(done)
  })
  return Feed.of({
    stream: Stream.fromQueue(queue).pipe(Stream.flatMap((item) =>
      Stream.fromEffect(item.result).pipe(Stream.ensuring(Deferred.succeed(item.done, undefined))),
    )),
    send: (event) => send(Effect.succeed(event)),
    fail: (error) => send(Effect.fail(error)),
    end: Queue.end(queue),
    sources: new Set(),
    beforeGuard: undefined,
  })
})) })
const model = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}
export const config = {
  provider: { test: {
    name: "Test", id: "test", env: [], npm: "@ai-sdk/openai-compatible",
    models: { "test-model": {
      id: "test-model", name: "Test Model", attachment: false,
      reasoning: true, temperature: false, tool_call: true,
      release_date: "2025-01-01", limit: { context: 100000, output: 10000 }, options: {},
    } },
    options: { apiKey: "test-key", baseURL: "http://localhost:1/v1" },
  } },
}
const llm = LayerNode.make({ service: LLM.Service, deps: [feed], layer: Layer.effect(LLM.Service,
  Effect.map(Feed, (feed) => LLM.Service.of({ stream: () => feed.stream })),
) })
const live = LayerNode.make({ service: LiveEvents.Service, deps: [feed], layer: Layer.effect(LiveEvents.Service,
  Effect.gen(function* () {
    const real = yield* LiveEvents.Service
    const feed = yield* Feed
    return LiveEvents.Service.of({ ...real,
      guard: (id, work) => Effect.suspend(() => (feed.beforeGuard?.() ?? Effect.void).pipe(Effect.andThen(real.guard(id, work)))),
      register: (id, source, onEvent) => Effect.gen(function* () {
        feed.sources.add(source)
        const off = yield* real.register(id, source, onEvent)
        return () => { feed.sources.delete(source); off() }
      }) })
  }),
).pipe(Layer.provide(LiveEvents.layer)) })

export const it = testEffect(LayerNode.compile(LayerNode.group([
  SessionProcessor.node, Session.node, SessionProjector.node, Database.node, Provider.node,
  EventV2Bridge.node, LiveEvents.node, SessionStatus.node, feed,
]), [
  [LLM.node, llm],
  [LiveEvents.node, live],
  [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true, disableDefaultPlugins: true })],
  [Snapshot.node, Layer.mock(Snapshot.Service, { track: () => Effect.succeed(undefined) })],
  [SessionSummary.node, Layer.mock(SessionSummary.Service, { summarize: () => Effect.void })],
]))

export const snapshot = (sessionID: SessionID) => Effect.gen(function* () {
  const session = yield* Session.Service
  const status = yield* SessionStatus.Service
  return { messages: yield* session.messages({ sessionID }), status: yield* status.get(sessionID) }
})

export const boot = Effect.gen(function* () {
  const session = yield* Session.Service
  const provider = yield* Provider.Service
  const processors = yield* SessionProcessor.Service
  const instance = yield* TestInstance
  const chat = yield* session.create()
  const older = yield* session.updateMessage({
    id: MessageID.ascending(), sessionID: chat.id, role: "user", agent: "build", model, time: { created: 1 },
  })
  const user = yield* session.updateMessage({ ...older, id: MessageID.ascending(), time: { created: 2 } })
  const assistant: SessionV1.Assistant = {
    id: MessageID.ascending(), sessionID: chat.id, parentID: user.id,
    role: "assistant", agent: "build", mode: "build",
    modelID: model.modelID, providerID: model.providerID,
    path: { cwd: instance.directory, root: instance.directory },
    time: { created: 3 }, cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
  yield* session.updateMessage(assistant)
  const mdl = yield* provider.getModel(model.providerID, model.modelID)
  const handle = yield* processors.create({ assistantMessage: assistant, sessionID: chat.id, model: mdl })
  const input: LLM.StreamInput = {
    user, sessionID: chat.id, model: mdl,
    agent: { name: "build", mode: "primary", options: {}, permission: [] },
    system: [], messages: [{ role: "user", content: "hi" }], tools: {},
  }
  return { session, chat, user, assistant, handle, input }
})
