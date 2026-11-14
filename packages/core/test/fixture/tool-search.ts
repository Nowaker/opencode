import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { Anthropic, OpenAI } from "@opencode/ai/providers"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { InstructionDiscovery } from "@opencode/core/instruction-discovery"
import { InstructionBuiltIns } from "@opencode/core/instructions/builtins"
import { Instructions } from "@opencode/core/instructions/index"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { McpInstructions } from "@opencode/core/mcp/instructions"
import { Model } from "@opencode/core/model"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { ReferenceInstructions } from "@opencode/core/reference/instructions"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionRunCoordinator } from "@opencode/core/session/run-coordinator"
import { SessionRunner } from "@opencode/core/session/runner/index"
import { SessionRunnerLLM } from "@opencode/core/session/runner/llm"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionStore } from "@opencode/core/session/store"
import { SkillInstructions } from "@opencode/core/skill/instructions"
import { Snapshot } from "@opencode/core/snapshot"
import { Tool } from "@opencode/core/tool"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Context, Effect, Layer, Schema } from "effect"
import { promptLocationNode } from "./prompt-location"
import { permissionLayer } from "../lib/permission"

export class SearchFixture extends Context.Service<SearchFixture, {
  readonly model: SessionRunnerModel.Resolved
  readonly bodies: Record<string, unknown>[]
}>()("test/SearchFixture") {}

export const searchLayer = (protocol: "openai" | "anthropic", reply: (step: number) => string) => {
  const fixture = Layer.effect(SearchFixture, Effect.gen(function* () {
    const bodies: Record<string, unknown>[] = []
    const server = yield* Effect.acquireRelease(
      Effect.sync(() => Bun.serve({
        hostname: "127.0.0.1", port: 0,
        async fetch(request) {
          bodies.push(Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(await request.json()))
          return new Response(reply(bodies.length), { headers: { "content-type": "text/event-stream" } })
        },
      })),
      (server) => Effect.promise(() => server.stop(true)),
    )
    const settings = { apiKey: false as const, baseURL: server.url.toString() }
    const model = protocol === "openai"
      ? OpenAI.configure(settings).responses("deployment")
      : Anthropic.configure(settings).model("deployment")
    return { bodies, model: SessionRunnerModel.resolved(model, {
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      cost: [], limit: { context: 200_000, output: 4096 },
    }) }
  }))
  const replacements = [
    Bus.node.replace(Bus.configured({ persist: true })),
    LocationServiceMap.node.replace(promptLocationNode),
    LayerNodePlatform.llmClient.replace(LLMClient.layer.pipe(Layer.provide(RequestExecutor.fetchLayer))),
    Permission.node.replace(permissionLayer()),
    Model.node.replace(Layer.mock(Model.Service, {
      get: () => Effect.undefined, all: () => Effect.succeed([]), available: () => Effect.succeed([]),
      default: () => Effect.undefined, small: () => Effect.undefined,
    })),
    SessionRunnerModel.node.replace(Layer.effect(SessionRunnerModel.Service, Effect.gen(function* () {
      const state = yield* SearchFixture
      return SessionRunnerModel.Service.of({ resolve: () => Effect.succeed(state.model) })
    })).pipe(Layer.provide(fixture))),
    InstructionBuiltIns.node.replace(Layer.mock(InstructionBuiltIns.Service, { load: () => Effect.succeed(Instructions.empty) })),
    InstructionDiscovery.node.replace(Layer.mock(InstructionDiscovery.Service, {
      project: true, global: true, load: () => Effect.succeed(Instructions.empty),
    })),
    Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/var/tmp") })),
    SkillInstructions.node.replace(Layer.mock(SkillInstructions.Service, { load: () => Effect.succeed(Instructions.empty) })),
    ReferenceInstructions.node.replace(Layer.mock(ReferenceInstructions.Service, { load: () => Effect.succeed(Instructions.empty) })),
    McpInstructions.node.replace(Layer.mock(McpInstructions.Service, { load: () => Effect.succeed(Instructions.empty) })),
    Config.node.replace(Config.testLayer()),
    Snapshot.node.replace(Snapshot.noopLayer),
    PluginSupervisor.node.replace(Layer.empty),
    Plugin.node.replace(Layer.mock(Plugin.Service, { awaitActivation: Effect.void })),
  ]
  const execution = Layer.effect(SessionExecution.Service, Effect.gen(function* () {
    const runner = yield* SessionRunner.Service
    const coordinator = yield* SessionRunCoordinator.make<Session.ID, SessionRunner.RunError>({
      drain: (sessionID, force) => runner.drain({ sessionID, force }).pipe(Effect.asVoid),
    })
    return SessionExecution.Service.of({
      identity: coordinator.identity, active: coordinator.active, isActive: coordinator.isActive,
      resume: coordinator.run, wake: coordinator.wake, interrupt: (sessionID) => coordinator.interrupt(sessionID), awaitIdle: coordinator.awaitIdle,
    })
  })).pipe(Layer.provide(AppNodeBuilder.build(SessionRunnerLLM.node, replacements)), Layer.orDie)
  return AppNodeBuilder.build(LayerNode.group([
    Database.node, Bus.node, SessionProjector.node, SessionStore.node, Agent.node, PluginHooks.node,
    Tool.node, Session.node,
  ]), [...replacements, SessionExecution.node.replace(execution)]).pipe(Layer.provideMerge(fixture))
}
