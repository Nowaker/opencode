import { expect } from "bun:test"
import { EngineStop } from "@opencode/core/engine-stop"
import { KVTable } from "@opencode/core/kv/sql"
import { ScheduleTable } from "@opencode/core/schedule/sql"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionMessage } from "@opencode/schema/session-message"
import { eq } from "drizzle-orm"
import { Cause, Clock, Context, Deferred, Duration, Effect, Exit, Fiber, Layer, Stream } from "effect"
import { TestClock } from "effect/testing"
import { forceInput, reopen, seal } from "./fixture/engine-stop"
import { scheduler, schedulerLayer } from "./fixture/engine-stop-schedule"
import { it, testEffect } from "./lib/effect"

const tests = testEffect(schedulerLayer())

tests.effect("refuses sealed native arming and updates without changing schedule rows", () =>
  Effect.gen(function* () {
    const s = yield* scheduler
    const claims = yield* EngineStop.Service
    const active = yield* s.create()
    const paused = yield* s.schedules.pause((yield* s.create()).id)
    const before = yield* s.schedules.list()
    expect((yield* seal(claims)).status).toBe("sealed")
    const actions: ReadonlyArray<Effect.Effect<unknown, unknown>> = [
      s.create(), s.schedules.resume(paused.id), s.schedules.pause(active.id), s.schedules.remove(active.id),
    ]
    for (const action of actions) {
      const result = yield* Effect.exit(action)
      expect(Exit.isFailure(result) ? Cause.squash(result.cause) : result).toMatchObject({
        _tag: "EngineStop.RefusedError", admission: { status: "not-admitted" },
      })
    }
    expect(yield* s.schedules.list()).toEqual(before)
  }),
)

tests.effect("vetoes idle for the actual direct-tick lease holder and names only its active schedules", () =>
  Effect.gen(function* () {
    const s = yield* scheduler
    const claims = yield* EngineStop.Service
    const due = yield* s.create()
    const future = yield* s.create()
    yield* s.schedules.pause((yield* s.create()).id)
    yield* s.db.update(ScheduleTable).set({ next_due_at: (yield* Clock.currentTimeMillis) - 1 })
      .where(eq(ScheduleTable.id, due.id)).run()
    yield* s.schedules.tick
    expect((yield* seal(claims)).status).toBe("refused")
    const operation = (yield* claims.get(EngineStop.OperationID.make("stop"))).operation
    expect(operation).toMatchObject({ status: "refused", reason: { type: "native-schedule-armed", scheduleIDs: [future.id] } })
    const peer = yield* s.peer
    expect((yield* seal(peer.claims, "non-leader")).status).toBe("sealed")
    yield* TestClock.adjust(60_001)
    expect((yield* seal(claims, "expired-lease")).status).toBe("sealed")
  }),
)

tests.effect("refuses sealed firing before admission, failure bookkeeping or lease acquisition", () =>
  Effect.gen(function* () {
    const s = yield* scheduler
    const claims = yield* EngineStop.Service
    const due = yield* s.create()
    yield* s.db.update(ScheduleTable).set({ next_due_at: (yield* Clock.currentTimeMillis) - 1 })
      .where(eq(ScheduleTable.id, due.id)).run()
    const before = yield* s.schedules.list()
    yield* seal(claims)
    const result = yield* s.schedules.tick.pipe(Effect.exit)
    expect(Exit.isFailure(result) ? Cause.squash(result.cause) : result).toMatchObject({ _tag: "EngineStop.RefusedError" })
    expect(yield* s.inbox.list(s.session.id)).toEqual([])
    expect(yield* s.schedules.list()).toEqual(before)
    expect(yield* s.db.select().from(KVTable).where(eq(KVTable.key, "schedule:leader")).all()).toEqual([])
  }),
)

tests.effect("force preparation preserves native rows and reopening permits the owed firing", () =>
  Effect.gen(function* () {
    const s = yield* scheduler
    const claims = yield* EngineStop.Service
    const due = yield* s.create()
    yield* s.db.update(ScheduleTable).set({ next_due_at: (yield* Clock.currentTimeMillis) - 1 })
      .where(eq(ScheduleTable.id, due.id)).run()
    const before = yield* s.schedules.list()
    const operation = yield* claims.prepare(yield* forceInput(claims))
    expect((yield* claims.awaitOperation(operation.operationID, 10_000)).status).toBe("sealed")
    expect(yield* s.schedules.list()).toEqual(before)
    yield* reopen(claims, operation)
    yield* s.schedules.tick
    expect((yield* s.schedules.get(due.id)).runCount).toBe(1)
    expect((yield* s.inbox.list(s.session.id)).map((item) => item.id)).toEqual([SessionMessage.ID.make(`msg_${due.id}_1`)])
  }),
)

it.effect("parks a sealed scheduler before its lease acquisition and resumes it after cancel", () =>
  Effect.gen(function* () {
    const parked = yield* Deferred.make<void>()
    const observed = Layer.effect(EngineStop.Service, Effect.gen(function* () {
      const claims = yield* EngineStop.Service
      return EngineStop.Service.of({ ...claims, awaitOpen: Deferred.succeed(parked, undefined).pipe(Effect.andThen(claims.awaitOpen)) })
    })).pipe(Layer.provide(EngineStop.layer))
    const context = yield* Layer.build(schedulerLayer([EngineStop.node.replace(observed)]))
    const claims = Context.get(context, EngineStop.Service)
    const s = yield* scheduler.pipe(Effect.provide(context))
    const due = yield* s.create()
    yield* s.db.update(ScheduleTable).set({ next_due_at: (yield* Clock.currentTimeMillis) - 1 })
      .where(eq(ScheduleTable.id, due.id)).run()
    const notice = yield* s.bus.subscribe(SessionEvent.InboxEnqueued).pipe(
      Stream.filter((event) => event.data.sessionID === s.session.id),
      Stream.take(1), Stream.runCollect, Effect.forkScoped({ startImmediately: true }),
    )
    const clock = yield* Clock.Clock
    const loopWaiting = yield* Deferred.make<void>()
    const operation = yield* seal(claims)
    const run = yield* s.schedules.run.pipe(
      Effect.provideService(Clock.Clock, {
        ...clock,
        // The loop's 30-second wait follows tick settlement; the concurrent heartbeat waits 20 seconds.
        sleep: (duration) => Duration.toMillis(duration) === 30_000
          ? Deferred.succeed(loopWaiting, undefined).pipe(Effect.andThen(Effect.never))
          : Effect.never,
      }),
      Effect.forkScoped,
    )
    yield* Effect.raceFirst(
      Effect.raceFirst(
        Deferred.await(parked),
        Deferred.await(loopWaiting).pipe(Effect.andThen(Effect.die(new Error("sealed scheduler armed a timer before parking")))),
      ),
      Fiber.await(run).pipe(Effect.flatMap((exit) => Exit.isFailure(exit) ? exit : Effect.die(new Error("scheduler exited before parking")))),
    )
    expect(yield* s.db.select().from(KVTable).where(eq(KVTable.key, "schedule:leader")).all()).toEqual([])
    yield* reopen(claims, operation)
    yield* Effect.raceFirst(
      Fiber.join(notice),
      Fiber.await(run).pipe(Effect.andThen(Effect.die(new Error("scheduler exited before its owed admission after cancel")))),
    )
    yield* Deferred.await(loopWaiting)
    expect((yield* s.schedules.get(due.id)).runCount).toBe(1)
    yield* Fiber.interrupt(run)
  }),
)
