import { describe, expect, test } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { EventTable } from "@opencode/core/event/sql"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { mergeMetadata } from "@opencode/core/session/metadata"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import type { SessionMetadata } from "@opencode/schema/session-metadata"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { asc, eq } from "drizzle-orm"
import { Effect, Fiber, Layer, Stream } from "effect"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const layer = AppNodeBuilder.build(
  LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
  [
    Bus.node.replace(Bus.configured({ persist: true })),
    Project.node.replace(globalProjectNode),
    SessionExecution.node.replace(SessionExecution.noopLayer),
    SessionStore.node.replace(
      SessionStore.node.mapLayer((base) =>
        Layer.effect(
          SessionStore.Service,
          Effect.map(SessionStore.Service, (store) =>
            SessionStore.Service.of({
              ...store,
              // Yield after the real read, as asynchronous database adapters can, to expose stale snapshots.
              get: (id) => store.get(id).pipe(Effect.tap(() => Effect.yieldNow)),
            }),
          ),
        ).pipe(Layer.provide(base)),
      ),
    ),
  ],
)
const it = testEffect(layer)
const location = Location.Ref.make({ directory: AbsolutePath.make("/metadata") })

describe("mergeMetadata", () => {
  const cases: {
    name: string
    current: SessionMetadata | undefined
    patch: SessionMetadata
    expected: SessionMetadata
  }[] = [
    { name: "absent metadata", current: undefined, patch: { a: 1 }, expected: { a: 1 } },
    { name: "add a member", current: { a: "b" }, patch: { c: "d" }, expected: { a: "b", c: "d" } },
    { name: "replace a scalar", current: { a: "b" }, patch: { a: false }, expected: { a: false } },
    { name: "delete a member", current: { a: "b", b: "c" }, patch: { a: null }, expected: { b: "c" } },
    { name: "delete an absent member", current: { a: 1 }, patch: { missing: null }, expected: { a: 1 } },
    { name: "replace an array", current: { a: [1, 2] }, patch: { a: [3] }, expected: { a: [3] } },
    { name: "replace an object with a scalar", current: { a: { b: 1 } }, patch: { a: 2 }, expected: { a: 2 } },
    {
      name: "replace an object with an array",
      current: { a: { b: 1 } },
      patch: { a: [null] },
      expected: { a: [null] },
    },
    {
      name: "replace a scalar with an object",
      current: { a: 1 },
      patch: { a: { b: 2, c: null } },
      expected: { a: { b: 2 } },
    },
    { name: "replace an array with an empty object", current: { a: [1] }, patch: { a: {} }, expected: { a: {} } },
    {
      name: "preserve an existing object with an empty patch",
      current: { a: { b: 1 } },
      patch: { a: {} },
      expected: { a: { b: 1 } },
    },
    { name: "preserve unpatched nulls", current: { a: null }, patch: {}, expected: { a: null } },
    {
      name: "merge and delete nested keys",
      current: { a: { b: 1, c: 2 }, d: 3 },
      patch: { a: { b: null, e: 4 } },
      expected: { a: { c: 2, e: 4 }, d: 3 },
    },
    {
      name: "preserve arbitrary own keys",
      current: { ["__proto__"]: { a: 1 }, constructor: 2 },
      patch: { ["__proto__"]: { b: 2 }, constructor: null },
      expected: { ["__proto__"]: { a: 1, b: 2 } },
    },
  ]
  test.each(cases)("$name", ({ current, patch, expected }) => {
    const before = structuredClone({ current, patch })

    const result = mergeMetadata(current, patch)

    expect(result).toEqual(expected)
    expect({ current, patch }).toEqual(before)
  })
})

describe("Session.setMetadata", () => {
  const replacements: SessionMetadata[] = [{ next: null }, {}]
  for (const metadata of replacements) {
    it.effect(`replaces metadata by default with ${JSON.stringify(metadata)}`, () =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const created = yield* session.create({ location, metadata: { previous: true } })

        yield* session.setMetadata({ sessionID: created.id, metadata })

        expect((yield* session.get(created.id)).metadata).toEqual(metadata)
      }),
    )
  }

  it.effect("publishes and persists the complete merged record for equivalent replay", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({
        location,
        metadata: { retained: true, nested: { drop: 1, keep: 2 } },
      })
      const events = yield* bus
        .subscribe(SessionEvent.MetadataUpdated)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* session.setMetadata({
        sessionID: created.id,
        mode: "merge",
        metadata: { nested: { drop: null, add: 3 } },
      })

      const expected = { retained: true, nested: { keep: 2, add: 3 } }
      expect((yield* session.get(created.id)).metadata).toEqual(expected)
      expect((yield* Fiber.join(events)).map((event) => event.data)).toEqual([
        { sessionID: created.id, metadata: expected },
      ])
      const rows = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, created.id))
        .orderBy(asc(EventTable.seq))
        .all()
      expect(rows.map((row) => row.type)).toEqual(["session.created.1", "session.metadata.updated.1"])
      expect(rows[1].data).toEqual({ sessionID: created.id, metadata: expected })
      const replayed = yield* Effect.gen(function* () {
        const bus = yield* Bus.Service
        const session = yield* Session.Service
        yield* session.create({ location })
        yield* Effect.forEach(rows, (row) =>
          bus.replay({
            id: row.id,
            type: row.type,
            seq: row.seq,
            aggregateID: row.aggregate_id,
            created: row.created,
            data: row.data,
          }),
        )
        return (yield* session.get(created.id)).metadata
      }).pipe(Effect.provide(Layer.fresh(layer)))
      expect(replayed).toEqual(expected)
    }),
  )

  it.effect("merges into absent metadata and treats null as deletion", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const created = yield* session.create({ location })

      yield* session.setMetadata({ sessionID: created.id, mode: "merge", metadata: { added: 1, missing: null } })

      expect((yield* session.get(created.id)).metadata).toEqual({ added: 1 })
    }),
  )

  it.effect("serializes concurrent merges of sibling metadata keys", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const created = yield* session.create({ location, metadata: { nested: { retained: true } } })

      yield* Effect.all(
        ["one", "two", "three", "four"].map((key) =>
          session.setMetadata({
            sessionID: created.id,
            mode: "merge",
            metadata: { nested: { [key]: key } },
          }),
        ),
        { concurrency: "unbounded" },
      )

      expect((yield* session.get(created.id)).metadata).toEqual({
        nested: { retained: true, one: "one", two: "two", three: "three", four: "four" },
      })
    }),
  )

  for (const mode of [undefined, "merge"] as const) {
    it.effect(`preserves NotFoundError for ${mode ?? "replacement"} of an unknown session`, () =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const { db } = yield* Database.Service
        const sessionID = Session.ID.make("ses_missing_metadata")

        const error = yield* session.setMetadata({ sessionID, metadata: {}, mode }).pipe(Effect.flip)

        expect(error).toEqual(new Session.NotFoundError({ sessionID }))
        expect(yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, sessionID)).all()).toEqual([])
      }),
    )
  }
})
