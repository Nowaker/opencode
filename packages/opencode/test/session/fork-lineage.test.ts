import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { EventTable } from "@opencode-ai/core/event/sql"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Session } from "@/session/session"
import { eq } from "drizzle-orm"
import { MessageID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Session.node, SessionProjector.node, Database.node])))

for (const metadata of [undefined, {}, { vibeterm: { lineage: { sessionId: "foreign", kind: "clone" } } }]) {
  it.instance(`publishes the exact fork source before copying messages with ${JSON.stringify(metadata)} metadata`, () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const source = yield* sessions.create({ metadata })
      yield* sessions.updateMessage({
        id: MessageID.ascending(),
        sessionID: source.id,
        role: "user",
        time: { created: 1 },
        agent: "build",
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
      })
      const fork = yield* sessions.fork({ sessionID: source.id })
      const lineage = { sessionId: fork.id, kind: "native-fork", originalObjectId: source.id }
      const events = yield* database.db.select().from(EventTable)
        .where(eq(EventTable.aggregate_id, fork.id)).orderBy(EventTable.seq).all().pipe(Effect.orDie)
      const created = events[0]
      expect(created?.type).toBe("session.created.1")
      expect(created?.seq).toBe(0)
      expect(Schema.decodeUnknownSync(Session.Event.Created.data)(created?.data).info.metadata).toEqual({ vibeterm: { lineage } })
      expect(events[1]?.type).toBe("message.updated.1")
      expect(fork.metadata?.vibeterm.lineage).toEqual(lineage)
      expect((yield* sessions.get(fork.id)).metadata?.vibeterm.lineage).toEqual(lineage)
      expect((yield* sessions.messages({ sessionID: fork.id })).length).toBe(1)
      expect((yield* sessions.get(source.id)).metadata).toEqual(metadata)
    }),
  )
}

it.instance("preserves only source-bound lineage through nested native forks without inheriting execution", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const source = yield* sessions.create({})
    const lineage = { sessionId: source.id, kind: "import", originalObjectId: "archive" }
    const metadata = {
      external: { retained: true },
      vibeterm: {
        lineage,
        creator: { objectId: "older", machineId: "historical" },
        origin: { sessionId: "not-the-source" },
        notes: [{ text: "keep" }],
        lastExecution: { sessionId: source.id, machineId: "historical" },
      },
    }
    yield* sessions.setMetadata({ sessionID: source.id, metadata })

    const fork = yield* sessions.fork({ sessionID: source.id })
    const forkLineage = { sessionId: fork.id, kind: "native-fork", originalObjectId: source.id, sourceLineage: lineage }
    expect(fork.metadata).toEqual({
      external: metadata.external,
      vibeterm: {
        lineage: forkLineage,
        creator: metadata.vibeterm.creator,
        origin: metadata.vibeterm.origin,
        notes: metadata.vibeterm.notes,
      },
    })
    const nested = yield* sessions.fork({ sessionID: fork.id })
    expect(nested.metadata?.vibeterm.lineage).toEqual({
      sessionId: nested.id,
      kind: "native-fork",
      originalObjectId: fork.id,
      sourceLineage: forkLineage,
    })
    expect((yield* sessions.get(source.id)).metadata?.vibeterm.lineage).toEqual(lineage)
  }),
)
