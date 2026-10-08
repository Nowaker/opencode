import { expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Stream } from "effect"
import { Database } from "../src/database/database"
import { EventV2 } from "../src/event"
import { EventSequenceTable, EventTable } from "../src/event/sql"
import { Session } from "@opencode-ai/schema/session"
import { SessionV1 } from "@opencode-ai/schema/session-v1"
import { eq } from "drizzle-orm"
import { holdSqliteWriter } from "./fixture/sqlite-lock"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const definition = SessionV1.Event.MessageRemoved
const sessionID = Session.ID.make("ses_contention")
const data = { sessionID, messageID: SessionV1.MessageID.ascending("msg_contention") }

const database = (filename: string) => EventV2.layerWith().pipe(Layer.provideMerge(Database.layerFromPath(filename)))
const directory = Effect.acquireRelease(
  Effect.promise(() => tmpdir()),
  (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
)

for (const timeout of [10, 5000]) {
  it.live(
    `durable publish executes once after a separate writer outlasts busy_timeout=${timeout}`,
    () =>
      Effect.gen(function* () {
        const tmp = yield* directory
        yield* Effect.gen(function* () {
          const db = (yield* Database.Service).db
          const events = yield* EventV2.Service
          yield* db.run(`PRAGMA busy_timeout = ${timeout}`)
          const projected: EventV2.ID[] = []
          const committed: number[] = []
          const notified: EventV2.ID[] = []
          const ready = yield* Deferred.make<void>()
          yield* events.project(definition, (event) =>
            Effect.sync(() => {
              projected.push(event.id)
            }),
          )
          yield* events.listen((event) =>
            Effect.sync(() => {
              notified.push(event.id)
            }),
          )
          const durable = yield* events.durable({ aggregateID: sessionID }).pipe(
            Stream.tap(() => Deferred.succeed(ready, undefined)),
            Stream.take(1),
            Stream.runCollect,
            Effect.forkScoped,
          )
          yield* Effect.yieldNow
          yield* holdSqliteWriter(`${tmp.path}/events.db`, timeout + 250)
          const id = EventV2.ID.create()
          const result = yield* events
            .publish(definition, data, {
              id,
              commit: (seq) =>
                Effect.sync(() => {
                  committed.push(seq)
                }),
            })
            .pipe(Effect.exit)
          expect(result._tag).toBe("Success")
          const event = yield* result
          yield* Deferred.await(ready)
          expect(Array.from(yield* Fiber.join(durable)).map((event) => event.id)).toEqual([id])
          expect(event.id).toBe(id)
          expect(event.durable?.seq).toBe(0)
          expect(projected).toEqual([id])
          expect(committed).toEqual([0])
          expect(notified).toEqual([id])
          expect(yield* db.select().from(EventTable).all()).toHaveLength(1)
          expect((yield* db.select().from(EventSequenceTable).get())?.seq).toBe(0)
        }).pipe(Effect.scoped, Effect.provide(database(`${tmp.path}/events.db`)))
      }),
    20_000,
  )
}

it.live("claim and removal recover acquisition contention without changing replay semantics", () =>
  Effect.gen(function* () {
    const tmp = yield* directory
    yield* Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const events = yield* EventV2.Service
      yield* db.run("PRAGMA busy_timeout = 10")
      const published = yield* events.publish(definition, data)
      yield* Effect.scoped(
        holdSqliteWriter(`${tmp.path}/events.db`, 150).pipe(Effect.andThen(events.claim(sessionID, "owner"))),
      )
      expect((yield* db.select().from(EventSequenceTable).get())?.owner_id).toBe("owner")
      const replay = {
        id: published.id,
        aggregateID: sessionID,
        seq: 0,
        type: EventV2.versionedType(definition.type, published.durable?.version ?? 1),
        data,
      }
      yield* events.replay(replay, { ownerID: "owner", strictOwner: true })
      expect(yield* db.select().from(EventTable).all()).toHaveLength(1)
      const mismatch = yield* events.replay(replay, { ownerID: "other", strictOwner: true }).pipe(Effect.exit)
      expect(Exit.isFailure(mismatch)).toBe(true)
      yield* Effect.scoped(
        holdSqliteWriter(`${tmp.path}/events.db`, 150).pipe(Effect.andThen(events.remove(sessionID))),
      )
      yield* events.replay(replay, { ownerID: "other" })
      expect((yield* db.select().from(EventSequenceTable).get())?.owner_id).toBe("other")
      expect((yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, sessionID)).get())?.seq).toBe(0)
    }).pipe(Effect.scoped, Effect.provide(database(`${tmp.path}/events.db`)))
  }),
)

it.live("interrupting a contended durable publication commits no event", () =>
  Effect.gen(function* () {
    const tmp = yield* directory
    yield* Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const events = yield* EventV2.Service
      yield* db.run("PRAGMA busy_timeout = 10")
      yield* holdSqliteWriter(`${tmp.path}/events.db`, 500)
      const publisher = yield* events.publish(definition, data).pipe(Effect.forkScoped)
      yield* Effect.sleep(30)
      yield* Fiber.interrupt(publisher)
      const exit = yield* Fiber.await(publisher)
      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
      expect(yield* db.select().from(EventTable).all()).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(database(`${tmp.path}/events.db`)))
  }),
)
