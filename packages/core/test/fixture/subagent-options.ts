import { Effect, Layer, Schema, Stream } from "effect"
import { LanguageModel } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { Agent } from "@opencode/core/agent"
import { Job } from "@opencode/core/job"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { SessionStore } from "@opencode/core/session/store"
import { SessionExecution } from "@opencode/core/session/execution"
import { SubagentJob } from "@opencode/core/session/subagent-job"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { Tool } from "@opencode/core/tool"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./global"
import { offlineModels } from "./models"
import { tmpdirScoped } from "./tmpdir"
import { testEffect } from "../lib/effect"
import { executeTool, toolIdentity } from "../lib/tool"

const llm = TestLLM.testLayer({ fallback: TestLLM.text("child response", "reply") })
export const it = testEffect(
  Layer.merge(
    llm,
    AppNodeBuilder.build(
      LayerNode.group([
        Session.node,
        Job.node,
        LocationServiceMap.node,
        SessionRestart.node,
        SessionStore.node,
        SessionExecution.node,
        SubagentJob.node,
        Database.node,
        Bus.node,
      ]),
      [
        Global.node.replace(tempGlobalLayer),
        offlineModels,
        Watcher.node.replace(Watcher.configured({ enabled: false })),
        LayerNodePlatform.llmClient.replace(llm),
        SessionRunnerModel.node.replace(
          Layer.succeed(SessionRunnerModel.Service, {
            resolve: () =>
              Effect.succeed(
                SessionRunnerModel.resolved(
                  LanguageModel.make({ id: "child", provider: "test", route: OpenAIChat.route }),
                  {
                    capabilities: { tools: true, input: ["text"], output: ["text"] },
                    cost: [],
                    limit: { context: 200_000, output: 32_000 },
                  },
                ),
              ),
          }),
        ),
      ],
    ),
  ),
)

export const setup = Effect.gen(function* () {
  const dir = yield* tmpdirScoped()
  yield* Effect.promise(() =>
    Bun.write(
      `${dir.path}/opencode.json`,
      JSON.stringify({
        agents: { reviewer: { mode: "subagent", model: "test/child" } },
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      }),
    ),
  )
  const sessions = yield* Session.Service
  const model = Model.Ref.make({ id: Model.ID.make("parent"), providerID: Provider.ID.make("test") })
  const parent = yield* sessions.create({
    location: { directory: AbsolutePath.make(dir.path) },
    agent: Agent.ID.make("build"),
    model,
  })
  const locations = yield* LocationServiceMap.Service
  yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(Effect.provide(locations.get(parent.location)))
  const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
  const jobs = yield* Job.Service
  const bus = yield* Bus.Service
  return {
    sessions,
    parent,
    model,
    registry,
    jobs,
    bus,
    llm: yield* TestLLM.Test,
    db: (yield* Database.Service).db,
    call: (input: Record<string, unknown>, progress?: Parameters<Tool.Snapshot["execute"]>[0]["progress"]) =>
      executeTool(registry, {
        sessionID: parent.id,
        ...toolIdentity,
        progress,
        call: {
          type: "tool-call",
          id: crypto.randomUUID(),
          name: "subagent",
          input: { agent: "reviewer", description: "Review fixture", prompt: "review", ...input },
        },
      }),
    notice: bus.subscribe(SessionEvent.InboxEnqueued).pipe(
      Stream.filter((event) => event.data.sessionID === parent.id && event.data.item.type === "synthetic"),
      Stream.take(1),
      Stream.runCollect,
      Effect.forkScoped({ startImmediately: true }),
    ),
  }
})
export const childID = (input: unknown) =>
  Schema.decodeUnknownSync(Schema.Struct({ sessionID: Session.ID }))(input).sessionID
