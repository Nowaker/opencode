import { expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { EngineStop } from "@opencode/core/engine-stop"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionTable } from "@opencode/core/session/sql"
import { AbsolutePath } from "@opencode/schema/schema"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Fiber, Schema } from "effect"
import { childCancellationLayer, childFixture, Drains } from "./fixture/child-cancellation"
import { forceInput } from "./fixture/engine-stop"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(childCancellationLayer)
const isSessionEvent = Schema.is(SessionEvent.Durable)

it.live("retains the admitted move wake under force through recovery publication without a provider drain", () =>
  Effect.gen(function* () {
    const s = yield* childFixture
    const claims = yield* EngineStop.Service
    const bus = yield* Bus.Service
    const execution = yield* SessionExecution.Service
    const database = yield* Database.Service
    const drains = yield* Drains
    const destination = yield* tmpdirScoped()
    const operation = yield* Deferred.make<EngineStop.Operation>()
    const calls: string[] = []
    drains.set(s.child.id, Effect.sync(() => { calls.push("provider") }))
    const unsubscribe = yield* bus.listen((event) => {
      if (!isSessionEvent(event) || event.type !== SessionEvent.InboxEnqueued.type || event.data.sessionID !== s.child.id)
        return Effect.void
      return forceInput(claims).pipe(
        Effect.flatMap(claims.prepare),
        Effect.flatMap((result) => Deferred.succeed(operation, result)),
        Effect.asVoid, Effect.orDie,
      )
    })
    yield* Effect.addFinalizer(() => unsubscribe)
    const moving = yield* s.sessions.move({ sessionID: s.child.id, directory: AbsolutePath.make(destination.path) })
      .pipe(Effect.forkScoped)
    const stop = yield* Effect.raceFirst(
      Deferred.await(operation),
      Fiber.await(moving).pipe(Effect.andThen(Effect.die(new Error("move exited before durable admission")))),
    )
    yield* Fiber.await(moving)
    yield* execution.awaitIdle(s.child.id)
    const row = yield* database.db.select({ claim: SessionTable.time_suspended })
      .from(SessionTable).where(eq(SessionTable.id, s.child.id)).get()
    expect(row?.claim).toBeNumber()
    expect(calls).toEqual([])
    expect((yield* claims.awaitOperation(stop.operationID, 10_000)).status).toBe("sealed")
  }),
)
