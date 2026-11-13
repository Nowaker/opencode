import { expect } from "bun:test"
import { Database } from "@opencode/core/database/database"
import { Job } from "@opencode/core/job"
import { Session } from "@opencode/core/session"
import { SessionChildCancellation } from "@opencode/core/session/child-cancellation"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { SessionTable } from "@opencode/core/session/sql"
import { eq } from "drizzle-orm"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { TestClock } from "effect/testing"
import { Drains, childCancellationLayer, childFixture } from "./fixture/child-cancellation"
import { testEffect } from "./lib/effect"

const it = testEffect(childCancellationLayer)

it.effect("rejects a spoofed parent before stopping the persisted child or its Job", () =>
  Effect.gen(function* () {
    const f = yield* childFixture
    yield* f.start()
    yield* f.sessions.setMetadata({ sessionID: f.child.id, metadata: { parentID: "ses_spoofed" } })
    const execution = yield* SessionExecution.Service
    const before = yield* f.jobs.pendingBackground

    expect(
      yield* f.sessions.cancelChild({ ...f.input, parentID: Session.ID.create() }).pipe(Effect.flip),
    ).toMatchObject({ _tag: "Session.ParentMismatchError" })
    expect(yield* execution.isActive(f.child.id)).toBe(true)
    expect(yield* f.jobs.pendingBackground).toEqual(before)
    expect((yield* f.jobs.get(f.child.id))?.status).toBe("running")
    yield* f.sessions.cancelChild(f.input)
  }),
)

it.effect("stops a running child and settles its durable Job before cancelled, then distinguishes a repeat", () =>
  Effect.gen(function* () {
    const f = yield* childFixture
    yield* f.start()

    expect(yield* f.sessions.cancelChild(f.input)).toEqual({ status: "cancelled" })
    const execution = yield* SessionExecution.Service
    expect(yield* execution.isActive(f.child.id)).toBe(false)
    expect(yield* f.jobs.pendingBackground).toMatchObject([{ id: f.child.id, status: "cancelled" }])
    expect(yield* f.sessions.cancelChild(f.input)).toEqual({ status: "terminal", state: "cancelled" })
    expect((yield* f.sessions.get(f.child.id)).outcome).toBe("interrupted")
  }),
)

for (const [name, run, state] of [
  ["completed", Effect.void, "completed"],
  ["failed", Effect.die(new Error("fixture failure")), "error"],
] as const) {
  it.effect(`preserves a ${name} child as terminal without cancelling it`, () =>
    Effect.gen(function* () {
      const f = yield* childFixture
      yield* f.start(run)
      yield* f.jobs.awaitIdle(f.child.id)
      const before = yield* f.jobs.pendingBackground

      expect(yield* f.sessions.cancelChild(f.input)).toEqual({ status: "terminal", state })
      expect(yield* f.jobs.pendingBackground).toEqual(before)
    }),
  )
}

it.effect("returns unsupported for a child that has never had an execution or Job", () =>
  Effect.gen(function* () {
    const f = yield* childFixture
    expect(yield* f.sessions.cancelChild(f.input)).toMatchObject({ status: "unsupported" })
    expect(yield* f.jobs.pendingBackground).toEqual([])
    expect((yield* f.sessions.get(f.child.id)).outcome).toBeUndefined()
  }),
)

it.effect("does not mistake an older completed Job or persisted outcome for a resumed child's current state", () =>
  Effect.gen(function* () {
    const f = yield* childFixture
    yield* f.start(Effect.void)
    yield* f.jobs.awaitIdle(f.child.id)
    yield* TestClock.adjust(1)
    const started = yield* Deferred.make<void>()
    const drains = yield* Drains
    drains.set(f.child.id, Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)))
    yield* f.sessions.resume(f.child.id).pipe(Effect.forkScoped)
    yield* Deferred.await(started)

    expect(yield* f.sessions.cancelChild(f.input)).toEqual({ status: "cancelled" })
    expect(yield* f.sessions.cancelChild(f.input)).toEqual({ status: "terminal", state: "cancelled" })
  }),
)

for (const shadow of [false, true]) {
  it.effect(`refuses a remote owner's child even with a local shadow Job (${shadow})`, () =>
    Effect.gen(function* () {
      const f = yield* childFixture
      yield* f.start()
      const otherJobs = yield* Job.make
      if (shadow) yield* otherJobs.start({ id: f.child.id, type: "subagent", recovery: f.recovery, run: Effect.never })
      const otherContext = yield* Layer.build(
        Layer.fresh(SessionExecution.layer).pipe(Layer.provide(Layer.succeed(Job.Service, otherJobs))),
      )
      const cancel = yield* SessionChildCancellation.make.pipe(
        Effect.provideService(Job.Service, otherJobs),
        Effect.provideService(SessionExecution.Service, Context.get(otherContext, SessionExecution.Service)),
      )
      const before = yield* f.jobs.pendingBackground

      expect(yield* cancel(f.input)).toMatchObject({ status: "unsupported" })
      expect((yield* f.jobs.get(f.child.id))?.status).toBe("running")
      expect((yield* otherJobs.get(f.child.id))?.status).toBe(shadow ? "running" : undefined)
      expect(yield* f.jobs.pendingBackground).toEqual(before)
      const execution = yield* SessionExecution.Service
      expect(yield* execution.isActive(f.child.id)).toBe(true)
      yield* f.sessions.cancelChild(f.input)
    }),
  )
}

it.effect("keeps a bounded requested stop alive until slow execution cleanup settles", () =>
  Effect.gen(function* () {
    const f = yield* childFixture
    const cleaning = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
    yield* f.start(
      Effect.never.pipe(
        Effect.ensuring(Deferred.succeed(cleaning, undefined).pipe(Effect.andThen(Deferred.await(release)))),
      ),
    )
    const request = yield* f.sessions.cancelChild(f.input).pipe(Effect.forkScoped)
    yield* Deferred.await(cleaning)
    yield* TestClock.adjust("1 second")

    expect(yield* Fiber.join(request)).toEqual({ status: "requested" })
    const execution = yield* SessionExecution.Service
    expect(yield* execution.isActive(f.child.id)).toBe(true)
    expect((yield* f.jobs.pendingBackground)[0]?.status).toBe("running")
    yield* Deferred.succeed(release, undefined)
    yield* execution.awaitIdle(f.child.id)
    yield* f.jobs.awaitIdle(f.child.id)
    expect(yield* f.sessions.cancelChild(f.input)).toEqual({ status: "terminal", state: "cancelled" })
  }),
)

it.effect("waits for Job cleanup even after its status and execution are terminal", () =>
  Effect.gen(function* () {
    const f = yield* childFixture
    const cleaning = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
    yield* f.jobs.start({
      id: f.child.id,
      type: "subagent",
      recovery: f.recovery,
      run: Effect.never.pipe(
        Effect.ensuring(Deferred.succeed(cleaning, undefined).pipe(Effect.andThen(Deferred.await(release)))),
      ),
    })
    yield* f.jobs.background(f.child.id)
    const request = yield* f.sessions.cancelChild(f.input).pipe(Effect.forkScoped)
    yield* Deferred.await(cleaning)
    yield* TestClock.adjust("1 second")

    expect(yield* Fiber.join(request)).toEqual({ status: "requested" })
    expect((yield* f.jobs.get(f.child.id))?.status).toBe("cancelled")
    yield* Deferred.succeed(release, undefined)
    yield* f.jobs.awaitIdle(f.child.id)
    expect(yield* f.sessions.cancelChild(f.input)).toEqual({ status: "terminal", state: "cancelled" })
  }),
)

it.effect("cancels a recovered local child and releases the claim left by its former owner", () =>
  Effect.gen(function* () {
    const f = yield* childFixture
    const scope = yield* Scope.make()
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
    const oldJobs = yield* Job.make.pipe(Scope.provide(scope))
    const old = yield* Layer.buildWithScope(
      Layer.fresh(SessionExecution.layer).pipe(Layer.provide(Layer.succeed(Job.Service, oldJobs))),
      scope,
    )
    const owner = Context.get(old, SessionExecution.Service)
    const entered = yield* Deferred.make<void>()
    const drains = yield* Drains
    drains.set(f.child.id, Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)))
    yield* oldJobs.start({
      id: f.child.id,
      type: "subagent",
      recovery: f.recovery,
      run: owner.resume(f.child.id).pipe(Effect.as("done")),
    })
    yield* oldJobs.background(f.child.id)
    yield* Deferred.await(entered)
    yield* Scope.close(scope, Exit.void)
    const recovered = yield* Deferred.make<void>()
    drains.set(f.child.id, Deferred.succeed(recovered, undefined).pipe(Effect.andThen(Effect.never)))
    const restart = yield* SessionRestart.Service
    yield* restart.resumeSuspendedSessions
    const execution = yield* SessionExecution.Service
    yield* Deferred.await(recovered)
    expect(yield* execution.isActive(f.child.id)).toBe(true)

    expect(yield* f.sessions.cancelChild(f.input)).toEqual({ status: "cancelled" })
    const db = (yield* Database.Service).db
    const row = yield* db
      .select({ claim: SessionTable.time_suspended })
      .from(SessionTable)
      .where(eq(SessionTable.id, f.child.id))
      .get()
      .pipe(Effect.orDie)
    expect(row?.claim).toBeNull()
    expect((yield* f.jobs.get(f.child.id))?.status).toBe("cancelled")
  }),
)
