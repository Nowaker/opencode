import { Config } from "@opencode/core/config"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { EngineStop } from "@opencode/core/engine-stop"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Instance } from "@opencode/core/instance/service"
import { Schedule } from "@opencode/core/schedule"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionInbox } from "@opencode/core/session/inbox"
import { AbsolutePath } from "@opencode/schema/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Context, Effect, Layer } from "effect"
import { ownerGraph, ownerReplacements } from "./engine-stop-owner"
import { tempGlobalLayer } from "./global"
import { tmpdirScoped } from "./tmpdir"

export const schedulerLayer = (replacements: LayerNode.Replacements = []) => AppNodeBuilder.build(
  LayerNode.group([ownerGraph, Schedule.node, EngineStop.node, Instance.node, SessionExecution.node, SessionInbox.node]),
  [
    ...ownerReplacements,
    Global.node.replace(tempGlobalLayer),
    Config.node.replace(Config.configured({
      project: false, global: false, claude: false,
      content: JSON.stringify({ experimental: { schedules: true }, warming: false }),
    })),
    SessionExecution.node.replace(SessionExecution.noopLayer),
    ...replacements,
  ],
)

export const scheduler = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const directory = yield* tmpdirScoped()
  const session = yield* sessions.create({ location: { directory: AbsolutePath.make(directory.path) }, title: "Schedule fence" })
  const schedules = yield* Schedule.Service
  const database = yield* Database.Service
  const instances = yield* Instance.Service
  const execution = yield* SessionExecution.Service
  const inbox = yield* SessionInbox.Service
  const peer = Effect.gen(function* () {
    const context = yield* Layer.build(AppNodeBuilder.build(LayerNode.group([Schedule.node, EngineStop.node]), [
      Database.node.replace(Layer.succeed(Database.Service, database)),
      Session.node.replace(Layer.succeed(Session.Service, sessions)),
      SessionExecution.node.replace(Layer.succeed(SessionExecution.Service, execution)),
      Instance.node.replace(Layer.succeed(Instance.Service, instances)),
    ]).pipe(Layer.fresh))
    return { schedules: Context.get(context, Schedule.Service), claims: Context.get(context, EngineStop.Service) }
  })
  const create = () => schedules.create({
    sessionID: session.id, when: { type: "in", in: "1 hour" }, action: { type: "prompt", prompt: "owed wake" },
  })
  return { sessions, session, schedules, db: database.db, inbox, peer, create, bus: yield* Bus.Service }
})
