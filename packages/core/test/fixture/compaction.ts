import { LLMClient, LLMEvent, LanguageModel, type LLMRequest } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { llmClient } from "@opencode/core/effect/app-node-platform"
import { Location } from "@opencode/core/location"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionCompaction } from "@opencode/core/session/compaction"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionModelRequest } from "@opencode/core/session/model-request"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { Money } from "@opencode/schema/money"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { DateTime, Effect, Layer, Stream } from "effect"
import { testEffect } from "../lib/effect"

export const provider: {
  chunks: string[]
  requests: LLMRequest[]
  finish: "stop" | "length"
  summaryModel?: SessionRunnerModel.Resolved
} = {
  chunks: ["## Objective\nGenerated narrative"],
  requests: new Array<LLMRequest>(),
  finish: "stop",
}

export const model = SessionRunnerModel.resolved(
  LanguageModel.make({ id: "summary-model", provider: "test", route: OpenAIChat.route }),
  {
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    cost: [
      {
        input: Money.USDPerMillionTokens.make(1),
        output: Money.USDPerMillionTokens.make(2),
        cache: { read: Money.USDPerMillionTokens.make(0), write: Money.USDPerMillionTokens.make(0) },
      },
    ],
    limit: { context: 200_000, output: 32_000 },
  },
)

const client = Layer.mock(LLMClient.Service)({
  stream: (request: LLMRequest) => {
    provider.requests.push(request)
    return Stream.make(
      ...provider.chunks.map((text) => LLMEvent.textDelta({ id: "summary", text })),
      LLMEvent.stepFinish({
        index: 0,
        reason: { normalized: provider.finish },
        usage: { inputTokens: 15, nonCachedInputTokens: 15, outputTokens: 6 },
      }),
      LLMEvent.finish({ reason: { normalized: provider.finish } }),
    )
  },
  generate: () => Effect.die("unused"),
})

export const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      SessionCompaction.node,
      SessionModelRequest.node,
      PluginHooks.node,
      Agent.node,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      llmClient.replace(client),
      SessionRunnerModel.node.replace(
        Layer.mock(SessionRunnerModel.Service)({ resolve: () => Effect.succeed(provider.summaryModel ?? model) }),
      ),
      Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
    ],
  ),
)

export const user = (text: string) =>
  SessionMessage.User.make({
    id: SessionMessage.ID.create(),
    type: "user",
    text,
    time: { created: DateTime.makeUnsafe(0) },
  })

export const seed = Effect.gen(function* () {
  provider.requests = []
  provider.chunks = ["## Objective\nGenerated narrative"]
  provider.finish = "stop"
  provider.summaryModel = undefined
  const id = Session.ID.create()
  const db = (yield* Database.Service).db
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({ id, project_id: Project.ID.global, slug: id, directory: "/project", title: id, version: "test" })
    .run()
    .pipe(Effect.orDie)
  const store = yield* SessionStore.Service
  const session = yield* store.get(id)
  if (!session) return yield* Effect.die("missing fixture session")
  return session
})

export const loaded = (session: Session.Info, messages: readonly SessionMessage.Info[]) => ({
  session,
  messages,
  model,
  agent: { id: Agent.defaultID, info: Agent.Info.default(Agent.defaultID) },
  initial: [],
  tools: { definitions: [], execute: () => Effect.die("Compaction must not execute tools") },
})

export const manual = (context: ReturnType<typeof loaded>, inputID = SessionMessage.ID.create()) =>
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const compaction = yield* SessionCompaction.Service
    yield* bus.publish(SessionEvent.Compaction.Started, { sessionID: context.session.id, reason: "manual", inputID })
    return yield* compaction.compact({ reason: "manual", context, inputID })
  })

export const hooks = PluginHooks.Service
export const store = SessionStore.Service
