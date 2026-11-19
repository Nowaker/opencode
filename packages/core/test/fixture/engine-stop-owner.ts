import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionMessageTable } from "@opencode/core/session/sql"
import { AbsolutePath } from "@opencode/schema/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { offlineModels } from "./models"

export const ownerGraph = LayerNode.group([Database.node, Bus.node, Session.node])
export const ownerReplacements = [
  offlineModels,
  Bus.node.replace(Bus.configured({ persist: true })),
  Watcher.node.replace(Watcher.configured({ enabled: false })),
]

export const owner = Effect.gen(function* () {
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  const sessions = yield* Session.Service
  const sessionID = Session.ID.create()
  yield* database.db
    .insert(ProjectTable)
    .values({
      id: Project.ID.global,
      worktree: AbsolutePath.make("/engine-stop-fixture"),
      sandboxes: [],
    })
    .run()
  yield* bus.publish(SessionEvent.Created, {
    sessionID,
    projectID: Project.ID.global,
    location: { directory: AbsolutePath.make("/engine-stop-fixture") },
    slug: "engine-stop-fixture",
    version: "test",
  })
  return {
    sessions,
    sessionID,
    sequence: Bus.latestSequence(database.db, sessionID),
    messages: database.db
      .select({ id: SessionMessageTable.id, type: SessionMessageTable.type })
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.session_id, sessionID))
      .all(),
  }
})
