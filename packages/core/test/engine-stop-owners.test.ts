import { expect } from "bun:test"
import { EngineStop } from "@opencode/core/engine-stop"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { ProjectTable } from "@opencode/core/project/sql"
import { Session } from "@opencode/core/session"
import { InstructionEntry } from "@opencode/core/session/instruction-entry"
import { SessionTransfer } from "@opencode/core/session/transfer"
import { SessionInbox } from "@opencode/core/session/inbox"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { SessionMessage } from "@opencode/schema/session-message"
import { AbsolutePath } from "@opencode/schema/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Cause, Effect, Exit } from "effect"
import { seal } from "./fixture/engine-stop"
import { owner, ownerGraph, ownerReplacements } from "./fixture/engine-stop-owner"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([ownerGraph, EngineStop.node, InstructionEntry.node, SessionTransfer.node, SessionInbox.node]),
    ownerReplacements,
  ),
)

const sealed = Effect.gen(function* () {
  const service = yield* EngineStop.Service
  const operation = yield* seal(service)
  expect(operation.status).toBe("sealed")
  return operation
})

const refused = <A, E, R>(effect: Effect.Effect<A, E, R>, admission: EngineStop.RefusedError["admission"]) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect)
    expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : exit).toMatchObject({
      _tag: "EngineStop.RefusedError",
      admission,
    })
  })

const fresh = { status: "not-admitted" } as const

it.live("refuses a sealed prompt before admitting input", () =>
  Effect.gen(function* () {
    const s = yield* owner
    const inbox = yield* SessionInbox.Service
    const before = yield* s.sequence
    yield* sealed
    yield* refused(s.sessions.prompt({ sessionID: s.sessionID, text: "sealed prompt" }), fresh)
    expect(yield* s.sequence).toBe(before)
    expect(yield* inbox.list(s.sessionID)).toEqual([])
  }),
)

it.live("reports a same-ID retry of already admitted input as existing, and new input as not admitted", () =>
  Effect.gen(function* () {
    const s = yield* owner
    const inbox = yield* SessionInbox.Service
    const id = SessionMessage.ID.create()
    yield* s.sessions.synthetic({ sessionID: s.sessionID, id, text: "owed", resume: false })
    yield* sealed
    yield* refused(s.sessions.synthetic({ sessionID: s.sessionID, id, text: "retry" }), {
      status: "existing",
      inputID: id,
    })
    yield* refused(s.sessions.synthetic({ sessionID: s.sessionID, id: SessionMessage.ID.create(), text: "new" }), fresh)
    expect((yield* inbox.list(s.sessionID)).map((item) => item.id)).toEqual([id])
  }),
)

it.live("refuses sealed model selection and state mutations before publishing", () =>
  Effect.gen(function* () {
    const s = yield* owner
    const before = yield* s.sequence
    const metadata = (yield* s.sessions.get(s.sessionID)).metadata
    yield* sealed
    yield* refused(
      s.sessions.switchModel({
        sessionID: s.sessionID,
        model: { providerID: Provider.ID.make("sealed"), id: Model.ID.make("probe") },
      }),
      fresh,
    )
    yield* refused(s.sessions.setMetadata({ sessionID: s.sessionID, metadata: { sealed: true } }), fresh)
    yield* refused(s.sessions.revert.commit(s.sessionID), fresh)
    expect(yield* s.sequence).toBe(before)
    expect((yield* s.sessions.get(s.sessionID)).metadata).toEqual(metadata)
  }),
)

it.live("refuses sealed Session creation, fork and removal", () =>
  Effect.gen(function* () {
    const s = yield* owner
    const child = Session.ID.create()
    yield* sealed
    yield* refused(s.sessions.create({ id: child, parentID: s.sessionID }), fresh)
    yield* refused(s.sessions.fork({ sessionID: s.sessionID }), fresh)
    yield* refused(s.sessions.remove(s.sessionID), fresh)
    expect(Exit.isFailure(yield* Effect.exit(s.sessions.get(child)))).toBe(true)
    expect((yield* s.sessions.get(s.sessionID)).id).toBe(s.sessionID)
  }),
)

it.live("refuses a sealed environment write and still answers a bodyless read", () =>
  Effect.gen(function* () {
    const s = yield* owner
    yield* sealed
    yield* refused(s.sessions.environment({ sessionID: s.sessionID, variables: { SEALED: "1" } }), fresh)
    expect(yield* s.sessions.environment({ sessionID: s.sessionID })).toBeUndefined()
  }),
)

it.live("refuses sealed instruction entry writes", () =>
  Effect.gen(function* () {
    const s = yield* owner
    const entries = yield* InstructionEntry.Service
    const key = InstructionEntry.Key.make("kept")
    yield* entries.put({ sessionID: s.sessionID, key, value: "before" })
    yield* sealed
    yield* refused(entries.put({ sessionID: s.sessionID, key, value: "after" }), fresh)
    yield* refused(entries.remove({ sessionID: s.sessionID, key }), fresh)
    expect(yield* entries.list(s.sessionID)).toEqual([{ key, value: "before" }])
  }),
)

it.live("refuses a sealed import before resolving its project", () =>
  Effect.gen(function* () {
    const s = yield* owner
    const transfer = yield* SessionTransfer.Service
    const { db } = yield* Database.Service
    const directory = yield* tmpdirScoped()
    const exported = yield* transfer.export({ sessionID: s.sessionID })
    const imported = Session.ID.create()
    const projects = yield* db.select().from(ProjectTable).all()
    yield* sealed
    yield* refused(
      transfer.import({
        data: { ...exported, info: { ...exported.info, id: imported } },
        location: { directory: AbsolutePath.make(directory.path) },
      }),
      fresh,
    )
    expect(yield* db.select().from(ProjectTable).all()).toEqual(projects)
    expect(Exit.isFailure(yield* Effect.exit(s.sessions.get(imported)))).toBe(true)
  }),
)
