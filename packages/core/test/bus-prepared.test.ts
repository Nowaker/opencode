import { describe, expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { EventSequenceTable, EventTable } from "@opencode/core/event/sql"
import { AbsolutePath } from "@opencode/schema/schema"
import { Event } from "@opencode/schema/event"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { eq, sql } from "drizzle-orm"
import { Context, Deferred, Effect, Fiber, Option, Schema, Stream } from "effect"
import { testEffect } from "./lib/effect"

const Count = Bus.durable({
  type: "test.prepared.count",
  durable: { version: 1, aggregate: "id" },
  schema: { id: Schema.String, count: Schema.Number },
})
class Increment extends Context.Service<Increment, number>()("test.prepared.Increment") {}
class PreparationError extends Schema.TaggedError<PreparationError>()("PreparationError", {}) {}
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
    Bus.node.replace(Bus.configured({ persist: true })),
  ]),
)

describe("Bus.publishPrepared", () => {
  it.effect("prepares lazily with caller services and commits the full payload before notifying", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const id = Event.ID.create()
      const location = { directory: AbsolutePath.make("/prepared") }
      const observations: unknown[] = []
      yield* db.run("CREATE TABLE prepared_count (value integer NOT NULL)")
      yield* db.run("INSERT INTO prepared_count VALUES (4)")
      yield* bus.project(Count, (event) =>
        db.run(sql`UPDATE prepared_count SET value = ${event.data.count}`).pipe(Effect.orDie, Effect.asVoid),
      )
      yield* bus.listen((event) =>
        Effect.gen(function* () {
          observations.push({
            event,
            transaction: Option.isSome(yield* Effect.serviceOption(db.$client.transactionService)),
            stored: yield* db.select().from(EventTable).where(eq(EventTable.id, event.id)).get().pipe(Effect.orDie),
          })
        }),
      )
      const typed = yield* bus.subscribe(Count).pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      const live = yield* bus.subscribe().pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow
      const publication = bus.publishPrepared(Count, {
        aggregateID: id,
        prepare: () =>
          Effect.gen(function* () {
            const increment = yield* Increment
            const rows = yield* db.all<{ value: number }>("SELECT value FROM prepared_count").pipe(Effect.orDie)
            return { id, count: rows[0].value + increment }
          }),
        options: {
          id,
          metadata: { origin: "prepared" },
          location,
          commit: (seq) =>
            db.run(sql`UPDATE prepared_count SET value = value + ${seq + 1}`).pipe(Effect.orDie, Effect.asVoid),
        },
      })
      yield* db.run("UPDATE prepared_count SET value = 8")

      const event = yield* publication.pipe(Effect.provideService(Increment, 3))

      expect(event).toMatchObject({
        id,
        type: Count.type,
        data: { id, count: 11 },
        location,
        metadata: { origin: "prepared" },
        durable: { aggregateID: id, seq: 0, version: 1 },
      })
      expect(yield* db.all("SELECT value FROM prepared_count")).toEqual([{ value: 12 }])
      expect(observations).toEqual([
        {
          event,
          transaction: false,
          stored: {
            id,
            aggregate_id: id,
            seq: 0,
            created: event.created,
            type: "test.prepared.count.1",
            data: { id, count: 11 },
          },
        },
      ])
      expect(yield* Fiber.join(typed)).toEqual([event])
      expect(yield* Fiber.join(live)).toEqual([event])
    }),
  )

  it.effect("rolls back preparation writes and preserves typed failure without projection or notification", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const id = Event.ID.create()
      const error = new PreparationError()
      const observed: string[] = []
      yield* db.run("CREATE TABLE prepared_failure (value integer NOT NULL)")
      yield* bus.project(Count, () => Effect.sync(() => observed.push("project")))
      yield* bus.listen(() => Effect.sync(() => observed.push("notify")))

      const failure = yield* bus
        .publishPrepared(Count, {
          aggregateID: id,
          prepare: () =>
            db.run("INSERT INTO prepared_failure VALUES (1)").pipe(Effect.orDie, Effect.andThen(Effect.fail(error))),
        })
        .pipe(Effect.flip)

      expect(failure).toBe(error)
      expect(yield* db.all("SELECT value FROM prepared_failure")).toEqual([])
      expect(yield* db.select().from(EventTable).all()).toEqual([])
      expect(yield* db.select().from(EventSequenceTable).all()).toEqual([])
      expect(observed).toEqual([])
    }),
  )

  it.effect("rejects a changed aggregate before projection and rolls back preparation", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const id = Event.ID.create()
      const other = Event.ID.create()
      const observed: string[] = []
      yield* db.run("CREATE TABLE prepared_mismatch (value integer NOT NULL)")
      yield* bus.project(Count, () => Effect.sync(() => observed.push("project")))
      yield* bus.listen(() => Effect.sync(() => observed.push("notify")))

      const defect = yield* bus
        .publishPrepared(Count, {
          aggregateID: id,
          prepare: () =>
            db.run("INSERT INTO prepared_mismatch VALUES (1)").pipe(Effect.orDie, Effect.as({ id: other, count: 1 })),
        })
        .pipe(Effect.catchDefect(Effect.succeed))

      expect(defect).toEqual(
        new Bus.InvalidDurableEventError({
          type: Count.type,
          message: `Aggregate mismatch: expected ${id}, got ${other}`,
        }),
      )
      expect(yield* db.all("SELECT value FROM prepared_mismatch")).toEqual([])
      expect(yield* db.select().from(EventTable).all()).toEqual([])
      expect(yield* db.select().from(EventSequenceTable).all()).toEqual([])
      expect(observed).toEqual([])
    }),
  )

  it.effect("holds the aggregate lock through notification before preparing the next publication", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const id = Event.ID.create()
      const notifying = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const prepared: number[] = []
      yield* bus.listen((event) =>
        event.durable?.seq !== 0
          ? Effect.void
          : Deferred.succeed(notifying, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.asVoid),
      )
      const publish = (count: number) =>
        bus.publishPrepared(Count, {
          aggregateID: id,
          prepare: () =>
            Effect.sync(() => {
              prepared.push(count)
              return { id, count }
            }),
        })
      const first = yield* publish(1).pipe(Effect.forkScoped)
      yield* Deferred.await(notifying)
      const second = yield* publish(2).pipe(Effect.forkScoped)
      yield* Effect.yieldNow

      expect(prepared).toEqual([1])
      yield* Deferred.succeed(release, undefined)
      expect((yield* Fiber.join(first)).data.count).toBe(1)
      expect((yield* Fiber.join(second)).durable.seq).toBe(Event.Seq.make(1))
      expect(prepared).toEqual([1, 2])
    }),
  )

  it.effect("rolls back preparation and projection when a prepared event projector fails", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const id = Event.ID.create()
      const defect = new Error("prepared projection failed")
      const notifications: Event.Payload[] = []
      yield* db.run("CREATE TABLE prepared_projection (value integer NOT NULL)")
      yield* bus.project(Count, () =>
        db.run("INSERT INTO prepared_projection VALUES (2)").pipe(Effect.orDie, Effect.andThen(Effect.die(defect))),
      )
      yield* bus.listen((event) => Effect.sync(() => notifications.push(event)))

      const failure = yield* bus
        .publishPrepared(Count, {
          aggregateID: id,
          prepare: () =>
            db.run("INSERT INTO prepared_projection VALUES (1)").pipe(Effect.orDie, Effect.as({ id, count: 1 })),
        })
        .pipe(Effect.catchDefect(Effect.succeed))

      expect(failure).toBe(defect)
      expect(yield* db.all("SELECT value FROM prepared_projection")).toEqual([])
      expect(yield* db.select().from(EventTable).all()).toEqual([])
      expect(yield* db.select().from(EventSequenceTable).all()).toEqual([])
      expect(notifications).toEqual([])
    }),
  )

  it.effect("preserves the global option when preparation supplies an explicit location", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const id = Event.ID.create()

      const event = yield* bus.publishPrepared(Count, {
        aggregateID: id,
        prepare: () => Effect.succeed({ id, count: 1 }),
        options: { global: true, location: { directory: AbsolutePath.make("/explicit") } },
      })

      expect(event.location).toBeUndefined()
    }),
  )
})
