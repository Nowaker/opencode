import { expect } from "bun:test"
import { watch } from "node:fs"
import { Database } from "@opencode/core/database/database"
import { Instance } from "@opencode/core/instance/service"
import { Job } from "@opencode/core/job"
import { JobControl } from "@opencode/core/job/control"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { SessionStore } from "@opencode/core/session/store"
import { Shell } from "@opencode/core/shell"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppProcess } from "@opencode/util/process"
import { Context, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { childCancellationLayer, childFixture } from "./fixture/child-cancellation"
import { testEffect } from "./lib/effect"

const it = testEffect(childCancellationLayer)
const resistant = Effect.gen(function* () {
  const f = yield* childFixture
  const control = yield* JobControl.Service
  const locations = yield* LocationServiceMap.Service
  const shell = yield* Shell.Service.pipe(Effect.provide(locations.get(f.parent.location)))
  const ready = yield* Deferred.make<void>()
  const signalled = yield* Deferred.make<void>()
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      watch(f.parent.location.directory, (_event, file) => {
        if (file === "ready") Deferred.doneUnsafe(ready, Exit.void)
        if (file === "term") Deferred.doneUnsafe(signalled, Exit.void)
      }),
    ),
    (watcher) => Effect.sync(() => watcher.close()),
  )
  const info = yield* shell.create({
    shell: "/bin/sh",
    command: "trap ': > term' TERM; : > ready; while :; do sleep 300; done",
  })
  yield* Effect.addFinalizer(() => shell.stop(info.id).pipe(TestClock.withLive, Effect.ignore))
  yield* Deferred.await(ready).pipe(Effect.timeout("5 seconds"), TestClock.withLive)
  const pid = info.pid
  if (pid === undefined) throw new Error("The resistant shell did not expose its process ID")
  yield* f.jobs.start({
    id: info.id,
    type: "shell",
    recovery: { kind: "shell", sessionID: f.parent.id, shellID: info.id, command: info.command },
    run: shell.wait(info.id).pipe(Effect.as("exited")),
  })
  const job = yield* f.jobs.background(info.id)
  const notificationID = job?.notificationID
  if (notificationID === undefined) throw new Error("The native Job has no durable notification")
  return {
    ...f,
    control,
    shell,
    info,
    pid,
    signalled,
    notificationID,
    input: { parentID: f.parent.id, jobID: info.id },
  }
})

for (const succeeds of [true, false]) {
  it.effect(`includes native cleanup admitted after a settlement waiter starts (success=${succeeds})`, () =>
    Effect.gen(function* () {
      const f = yield* childFixture
      const stopping = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const observed = yield* Deferred.make<boolean>()
      const job = yield* f.jobs.start({ id: "early_waiter", type: "test", run: Effect.never })
      const waiter = yield* f.jobs.awaitIdle(job.id).pipe(
        Effect.tap((result) => Deferred.succeed(observed, result)),
        Effect.forkScoped({ startImmediately: true }),
      )
      const cancel = yield* f.jobs
        .cancel(job.id, {
          cleanup: Deferred.succeed(stopping, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(succeeds ? Effect.void : Effect.fail(new Error("Native cleanup failed"))),
          ),
        })
        .pipe(Effect.forkScoped({ startImmediately: true }))
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
      yield* Deferred.await(stopping)
      yield* TestClock.adjust(1)
      expect(yield* Deferred.isDone(observed)).toBe(false)
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(cancel)
      expect(yield* Fiber.join(waiter)).toBe(succeeds)
    }),
  )
}

if (process.platform !== "win32") {
  it.effect("keeps repeated native cancellation requested while a ready process resists SIGTERM", () =>
    Effect.gen(function* () {
      const f = yield* resistant
      const first = yield* f.control.cancel(f.input).pipe(Effect.forkScoped)
      yield* Deferred.await(f.signalled).pipe(Effect.timeout("5 seconds"), TestClock.withLive)
      yield* TestClock.adjust("1 second")
      expect(yield* Fiber.join(first)).toEqual({ status: "requested" })
      expect(process.kill(f.pid, 0)).toBe(true)
      const repeat = yield* f.control.cancel(f.input).pipe(Effect.forkScoped)
      yield* TestClock.adjust("1 second")
      expect(yield* Fiber.join(repeat)).toEqual({ status: "requested" })
      expect(process.kill(f.pid, 0)).toBe(true)
      yield* TestClock.adjust("1 second")
      expect(yield* f.shell.wait(f.info.id).pipe(Effect.timeout("5 seconds"), TestClock.withLive)).toMatchObject({
        signal: "SIGKILL",
      })
      expect(() => process.kill(f.pid, 0)).toThrow()
      expect(yield* f.control.cancel(f.input)).toEqual({ status: "terminal", state: "cancelled" })
    }),
  )

  it.effect("retains native settlement when its completion notification consumes the Job during escalation", () =>
    Effect.gen(function* () {
      const f = yield* resistant
      const request = yield* f.control.cancel(f.input).pipe(Effect.forkScoped)
      yield* Deferred.await(f.signalled).pipe(Effect.timeout("5 seconds"), TestClock.withLive)
      yield* TestClock.adjust("1 second")
      expect(yield* Fiber.join(request)).toEqual({ status: "requested" })
      yield* f.jobs.completeBackground(f.notificationID)
      const completed = yield* Deferred.make<boolean>()
      yield* f.jobs.awaitIdle(f.input.jobID).pipe(
        Effect.flatMap((success) => Deferred.succeed(completed, success)),
        Effect.forkScoped,
      )
      yield* TestClock.adjust("1 second")
      expect(yield* Deferred.isDone(completed)).toBe(false)
      expect(process.kill(f.pid, 0)).toBe(true)
      yield* TestClock.adjust("1 second")
      yield* Deferred.await(completed).pipe(Effect.timeout("5 seconds"), TestClock.withLive)
      expect(() => process.kill(f.pid, 0)).toThrow()
      expect(yield* f.jobs.get(f.input.jobID)).toBeUndefined()
      expect(yield* f.jobs.pendingBackground).toEqual([])
    }),
  )

  it.effect("preserves a failed native stop on retries instead of reporting terminal cancellation", () =>
    Effect.gen(function* () {
      const f = yield* resistant
      const database = yield* Database.Service
      const store = yield* SessionStore.Service
      const instances = yield* Instance.Service
      let attempts = 0
      const failure = Effect.sync(() => attempts++).pipe(
        Effect.andThen(
          Effect.fail(
            new AppProcess.AppProcessError({ command: f.info.command, cause: new Error("Native signal refused") }),
          ),
        ),
      )
      const context = yield* Layer.build(
        LayerNode.compile(JobControl.node, {
          replacements: [
            Database.node.replace(Layer.succeed(Database.Service, database)),
            Job.node.replace(Layer.succeed(Job.Service, f.jobs)),
            SessionStore.node.replace(Layer.succeed(SessionStore.Service, store)),
            Instance.node.replace(
              Layer.succeed(Instance.Service, {
                ...instances,
                provide: (session) => (effect) =>
                  effect.pipe(
                    Effect.provideServiceEffect(
                      Shell.Service,
                      Shell.Service.pipe(
                        Effect.map((shell) => ({
                          ...shell,
                          stop: () => failure,
                        })),
                      ),
                    ),
                    instances.provide(session),
                  ),
              }),
            ),
          ],
        }).pipe(Layer.fresh),
      )
      const control = Context.get(context, JobControl.Service)
      expect(yield* control.cancel(f.input)).toMatchObject({ status: "unsupported" })
      expect(process.kill(f.pid, 0)).toBe(true)
      expect(yield* control.cancel(f.input)).toMatchObject({ status: "unsupported" })
      expect(process.kill(f.pid, 0)).toBe(true)
      expect(attempts).toBe(1)
      yield* f.jobs.completeBackground(f.notificationID)
      expect(yield* f.jobs.awaitIdle(f.input.jobID)).toBe(false)
      yield* Effect.sync(() => process.kill(-f.pid, "SIGKILL"))
      yield* f.shell.wait(f.info.id).pipe(Effect.timeout("5 seconds"), TestClock.withLive)
    }),
  )
}
