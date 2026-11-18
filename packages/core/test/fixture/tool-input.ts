import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionTable } from "@opencode/core/session/sql"
import { ToolOutput } from "@opencode/core/tool-output"
import type { Event } from "@opencode/schema/event"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { AbsolutePath } from "@opencode/schema/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect } from "effect"

export const toolInputLayer = AppNodeBuilder.build(
  LayerNode.group([Database.node, Bus.node, SessionProjector.node, ToolOutput.node]),
  [Bus.node.replace(Bus.configured({ persist: true }))],
)

export const toolInputFixture = Effect.gen(function* () {
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  const input = {
    sessionID: Session.ID.make("ses_tool_input_test"),
    assistantMessageID: SessionMessage.ID.make("msg_tool_input_test"),
    agent: Agent.defaultID,
    model: { id: Model.ID.make("test-model"), providerID: Provider.ID.make("test") },
    providerMetadataKey: "openai",
    started: 0,
  }
  yield* database.db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
  yield* database.db
    .insert(SessionTable)
    .values({
      id: input.sessionID,
      project_id: Project.ID.global,
      slug: "tool-input",
      directory: "/project",
      version: "test",
    })
    .run()
  const published: Event.Payload[] = []
  yield* Effect.acquireRelease(
    bus.listen((event) =>
      Effect.sync(() => {
        published.push(event)
      }),
    ),
    (unsubscribe) => unsubscribe,
  )
  return {
    bus,
    input,
    published,
    events: () => published.map((event) => ({ type: event.type, data: event.data })),
  }
})
