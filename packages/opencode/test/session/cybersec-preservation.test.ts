import { expect } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventTable } from "@opencode-ai/core/event/sql"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { eq } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "../server/httpapi-layer"

const sessionLayer = LayerNode.compile(LayerNode.group([Session.node, SessionProjector.node, Database.node]))
const it = testEffect(sessionLayer)
const api = testEffect(Layer.merge(sessionLayer, httpApiLayer))

// Seed storage independently of the new owner API so birth regressions can fail on their own.
const seedPreservation = Effect.fnUntraced(function* (
  sessionID: SessionID,
  cybersecPreservation: {
    readonly sessionId: SessionID
    readonly preference: "inherit" | "on" | "off"
    readonly revision: number
  },
) {
  const database = yield* Database.Service
  yield* database.db
    .update(SessionTable)
    .set({ metadata: { vibeterm: { cybersecPreservation } } })
    .where(eq(SessionTable.id, sessionID))
    .run()
})

for (const preference of ["on", "off"] as const) {
  it.instance(`stores a child's ${preference} preference at revision 1 in its birth event`, () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const parent = yield* sessions.create()
      yield* seedPreservation(parent.id, { sessionId: parent.id, preference, revision: 8 })

      const child = yield* sessions.create({ parentID: parent.id, metadata: { vibeterm: { notes: "keep" } } })
      const expected = { notes: "keep", cybersecPreservation: { sessionId: child.id, preference, revision: 1 } }

      expect(child.metadata?.vibeterm).toEqual(expected)
      expect((yield* sessions.get(child.id)).metadata?.vibeterm).toEqual(expected)
      const created = yield* database.db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, child.id))
        .orderBy(EventTable.seq)
        .get()
      expect(created?.type).toBe("session.created.1")
      const birth = Schema.decodeUnknownSync(Session.Event.Created.data)(created?.data)
      expect(birth.info.metadata?.vibeterm).toEqual(expected)
    }),
  )
}

for (const parentRecord of ["inherit", "copied"] as const) {
  it.instance(`starts a child at revision 0 when the parent's preference is ${parentRecord}`, () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const parent = yield* sessions.create()
      yield* seedPreservation(parent.id, {
        sessionId: parentRecord === "copied" ? SessionID.descending() : parent.id,
        preference: parentRecord === "copied" ? "on" : "inherit",
        revision: 9,
      })

      const child = yield* sessions.create({ parentID: parent.id })

      const stored = (yield* sessions.get(child.id)).metadata?.vibeterm?.cybersecPreservation
      const initial = { sessionId: child.id, preference: "inherit", revision: 0 }
      expect(stored ?? initial).toEqual(initial)
    }),
  )
}

for (const scenario of ["public create", "fork as child", "independent fork"] as const) {
  api.instance(`${scenario} takes preservation from the declared parent only`, () =>
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const sessions = yield* Session.Service
      const parent = yield* sessions.create()
      const source = yield* sessions.create()
      yield* seedPreservation(parent.id, { sessionId: parent.id, preference: "off", revision: 8 })
      yield* seedPreservation(source.id, { sessionId: source.id, preference: "on", revision: 12 })
      const parentID = scenario === "independent fork" ? undefined : parent.id

      const response = yield* requestInDirectory(
        scenario === "public create" ? "/session" : `/session/${source.id}/fork`,
        directory,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ parentID }) },
      )

      expect(response.status).toBe(200)
      const session = Schema.decodeUnknownSync(Session.Info)(yield* response.json)
      expect(session.parentID).toBe(parentID)
      expect(session.metadata?.vibeterm?.cybersecPreservation).toEqual(
        parentID ? { sessionId: session.id, preference: "off", revision: 1 } : undefined,
      )
    }),
  )
}
