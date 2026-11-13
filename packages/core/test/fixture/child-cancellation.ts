import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { Config } from "@opencode/core/config"
import { InstructionDiscovery } from "@opencode/core/instruction-discovery"
import { Bus } from "@opencode/core/bus"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Job } from "@opencode/core/job"
import { JobControl } from "@opencode/core/job/control"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Instance } from "@opencode/core/instance/service"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { SessionRunner } from "@opencode/core/session/runner/index"
import { SessionRunnerLLM } from "@opencode/core/session/runner/llm"
import { SessionStore } from "@opencode/core/session/store"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { AbsolutePath } from "@opencode/schema/schema"
import { Context, Deferred, Effect, Layer } from "effect"
import { tempGlobalLayer } from "./global"
import { offlineModels } from "./models"
import { tmpdirScoped } from "./tmpdir"

export class Drains extends Context.Service<Drains, Map<Session.ID, Effect.Effect<void, SessionRunner.RunError>>>()(
  "test/ChildCancellationDrains",
) {}

const runner = Layer.effect(
  SessionRunner.Service,
  Effect.gen(function* () {
    const drains = yield* Drains
    return SessionRunner.Service.of({
      drain: (input) =>
        (drains.get(input.sessionID) ?? Effect.void).pipe(Effect.as(SessionRunner.DrainResult.Complete())),
    })
  }),
)
const drainsNode = makeGlobalNode({ service: Drains, layer: Layer.sync(Drains, () => new Map()), deps: [] })
const runnerNode = makeLocationNode({ service: SessionRunner.Service, layer: runner, deps: [drainsNode] })

export const childCancellationLayer = AppNodeBuilder.build(
  LayerNode.group([
    Session.node,
    Job.node,
    JobControl.node,
    LocationServiceMap.node,
    SessionExecution.node,
    SessionRestart.node,
    SessionStore.node,
    Database.node,
    Bus.node,
    Instance.node,
    drainsNode,
  ]),
  [
    SessionRunnerLLM.node.replace(runnerNode),
    Config.node.replace(Config.configured({ project: false, global: false, claude: false, content: "{}" })),
    InstructionDiscovery.node.replace(InstructionDiscovery.configured({ project: false, global: false })),
    Global.node.replace(tempGlobalLayer),
    Watcher.node.replace(Watcher.configured({ enabled: false })),
    offlineModels,
  ],
)

export const childFixture = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const jobs = yield* Job.Service
  const drains = yield* Drains
  const directory = yield* tmpdirScoped()
  const parent = yield* sessions.create({ location: { directory: AbsolutePath.make(directory.path) } })
  const child = yield* sessions.create({ parentID: parent.id })
  const input = { parentID: parent.id, sessionID: child.id }
  const started = yield* Deferred.make<void>()
  const recovery = {
    kind: "subagent",
    parentSessionID: parent.id,
    childSessionID: child.id,
    agent: "general",
    description: "Cancellation fixture",
  } as const
  const start = Effect.fnUntraced(function* (run: Effect.Effect<void, SessionRunner.RunError> = Effect.never) {
    drains.set(child.id, Deferred.succeed(started, undefined).pipe(Effect.andThen(run)))
    yield* jobs.start({
      id: child.id,
      type: "subagent",
      recovery,
      run: sessions.resume(child.id).pipe(Effect.as("done")),
    })
    yield* jobs.background(child.id)
    yield* Deferred.await(started)
  })
  return { sessions, jobs, parent, child, input, start, recovery }
})
