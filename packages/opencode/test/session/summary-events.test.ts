import { expect } from "bun:test"
import { Effect, Exit } from "effect"
import { and, eq, sql } from "drizzle-orm"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { EventTable } from "@opencode-ai/core/event/sql"
import { MessageTable } from "@opencode-ai/core/session/sql"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Session } from "@/session/session"
import { SessionSummary } from "@/session/summary"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Snapshot } from "@/snapshot"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      Session.node,
      SessionSummary.node,
      MessageV2.node,
      Snapshot.node,
      SessionProjector.node,
      Database.node,
      CrossSpawnSpawner.node,
    ]),
  ),
)

const user = Effect.fn("test.user")(function* (sessionID: SessionID) {
  const sessions = yield* Session.Service
  return yield* sessions.updateMessage({
    id: MessageID.ascending(),
    sessionID,
    role: "user" as const,
    agent: "build",
    model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
    time: { created: 1 },
  })
})

const updates = Effect.fn("test.updates")(function* (sessionID: SessionID, messageID: MessageID) {
  const database = yield* Database.Service
  return yield* database.db
    .select()
    .from(EventTable)
    .where(
      and(
        eq(EventTable.aggregate_id, sessionID),
        eq(EventTable.type, "message.updated.1"),
        sql`json_extract(${EventTable.data}, '$.info.id') = ${messageID}`,
      ),
    )
    .orderBy(EventTable.seq)
    .all()
    .pipe(Effect.orDie)
})

it.live("keeps cached summaries unchanged when SQLite rejects persistence so a retry can publish", () =>
  provideTmpdirInstance(() =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const summary = yield* SessionSummary.Service
      const database = yield* Database.Service
      const session = yield* sessions.create({})
      const message = yield* user(session.id)
      const input = { sessionID: session.id, messageID: message.id }
      yield* database.db
        .update(MessageTable)
        .set({ time_updated: 1 })
        .where(eq(MessageTable.id, message.id))
        .run()
        .pipe(Effect.orDie)
      const before = yield* MessageV2.get(input)
      const original = yield* updates(session.id, message.id)

      const rejected = yield* Effect.acquireUseRelease(
        database.db
          .run(
            "CREATE TEMP TRIGGER reject_summary BEFORE UPDATE OF data ON message WHEN json_type(NEW.data, '$.summary.diffs') = 'array' BEGIN SELECT RAISE(ABORT, 'summary write rejected'); END",
          )
          .pipe(Effect.orDie),
        () =>
          Effect.gen(function* () {
            const exit = yield* summary.summarize(input).pipe(Effect.exit)
            const cached = yield* MessageV2.get(input)
            const stored = yield* database.db
              .select()
              .from(MessageTable)
              .where(eq(MessageTable.id, message.id))
              .get()
              .pipe(Effect.orDie)
            return { exit, cached, stored, events: yield* updates(session.id, message.id) }
          }),
        () => database.db.run("DROP TRIGGER reject_summary").pipe(Effect.orDie),
      )
      yield* summary.summarize(input)
      const cached = yield* MessageV2.get(input)
      const stored = yield* database.db
        .select()
        .from(MessageTable)
        .where(eq(MessageTable.id, message.id))
        .get()
        .pipe(Effect.orDie)

      expect(Exit.isFailure(rejected.exit)).toBe(true)
      expect(rejected.cached.info).toBe(before.info)
      expect(rejected.cached.info.summary).toBeUndefined()
      expect(rejected.stored?.data.summary).toBeUndefined()
      expect(rejected.events).toEqual(original)
      expect(stored?.data.summary).toEqual({ diffs: [] })
      expect(cached.info.summary).toEqual(stored?.data.summary)
      expect(yield* updates(session.id, message.id)).toHaveLength(original.length + 1)
    }),
  ),
)

it.live("publishes missing-to-empty diffs once without dropping existing events", () =>
  provideTmpdirInstance(() =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const summary = yield* SessionSummary.Service
      const session = yield* sessions.create({})
      const message = yield* user(session.id)
      const input = { sessionID: session.id, messageID: message.id }
      const original = yield* updates(session.id, message.id)

      yield* summary.summarize(input)
      const first = yield* updates(session.id, message.id)
      expect(first).toHaveLength(2)
      expect(first[0]).toEqual(original[0])
      yield* summary.summarize(input)

      expect(yield* updates(session.id, message.id)).toEqual(first)
      expect((yield* sessions.messages({ sessionID: session.id }))[0]?.info.summary).toEqual({ diffs: [] })

      yield* Effect.all(
        Array.from({ length: 4 }, () => summary.summarize(input)),
        { concurrency: "unbounded" },
      )
      expect(yield* updates(session.id, message.id)).toEqual(first)
    }),
  ),
)

it.live("suppresses repeated oversized summaries but publishes content changes and reversions", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const summary = yield* SessionSummary.Service
        const snapshot = yield* Snapshot.Service
        const session = yield* sessions.create({})
        const message = yield* user(session.id)
        const input = { sessionID: session.id, messageID: message.id }
        const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
        const assistant = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          parentID: message.id,
          role: "assistant",
          agent: "build",
          mode: "build",
          path: { cwd: dir, root: dir },
          modelID: message.model.modelID,
          providerID: message.model.providerID,
          time: { created: 2 },
          tokens,
          cost: 0,
        })
        yield* Effect.promise(() => Bun.write(`${dir}/large.txt`, "a".repeat(600_000) + "\n"))
        const before = yield* snapshot.track()
        yield* Effect.promise(() => Bun.write(`${dir}/large.txt`, "b".repeat(600_000) + "\n"))
        const after = yield* snapshot.track()
        expect(before).toBeTruthy()
        expect(after).toBeTruthy()
        yield* sessions.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: assistant.id,
          type: "step-start",
          snapshot: before,
        })
        const finish = yield* sessions.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: assistant.id,
          type: "step-finish",
          snapshot: after,
          reason: "stop",
          tokens,
          cost: 0,
        })
        yield* summary.summarize(input)
        const first = yield* updates(session.id, message.id)
        const initial = yield* summary.diff(input)
        expect(initial).toHaveLength(1)
        expect(JSON.stringify(first.at(-1)?.data).length).toBeGreaterThan(1_048_576)

        for (let index = 0; index < 8; index++) yield* summary.summarize(input)
        yield* Effect.all(
          Array.from({ length: 4 }, () => summary.summarize(input)),
          { concurrency: "unbounded" },
        )
        expect((yield* updates(session.id, message.id)).map((row) => row.id)).toEqual(first.map((row) => row.id))
        expect(yield* summary.diff(input)).toEqual(initial)

        yield* Effect.promise(() => Bun.write(`${dir}/large.txt`, "c".repeat(600_000) + "\n"))
        const changed = yield* snapshot.track()
        yield* sessions.updatePart({ ...finish, snapshot: changed })
        yield* summary.summarize(input)
        const next = yield* summary.diff(input)
        expect(next).not.toEqual(initial)
        expect(next.map((diff) => [diff.additions, diff.deletions])).toEqual(
          initial.map((diff) => [diff.additions, diff.deletions]),
        )
        expect(yield* updates(session.id, message.id)).toHaveLength(first.length + 1)

        yield* sessions.updatePart(finish)
        yield* summary.summarize(input)
        expect(yield* summary.diff(input)).toEqual(initial)
        expect(yield* updates(session.id, message.id)).toHaveLength(first.length + 2)

        yield* sessions.updatePart({ ...finish, snapshot: before })
        yield* summary.summarize(input)
        expect(yield* summary.diff(input)).toEqual([])
        const last = yield* updates(session.id, message.id)
        expect(last).toHaveLength(first.length + 3)
        expect(last.slice(0, first.length)).toEqual(first)
        const projected = (yield* sessions.messages({ sessionID: session.id })).find(
          (item) => item.info.id === message.id,
        )
        expect(projected?.info).toEqual({ ...message, summary: { diffs: [] } })
      }),
    { git: true },
  ),
)
