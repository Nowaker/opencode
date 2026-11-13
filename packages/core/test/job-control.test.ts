import { expect } from "bun:test"
import { Database } from "@opencode/core/database/database"
import { JobControl } from "@opencode/core/job/control"
import { JobTable } from "@opencode/core/job/sql"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { SessionMessage } from "@opencode/core/session/message"
import { Shell } from "@opencode/core/shell"
import { Deferred, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { childCancellationLayer, childFixture } from "./fixture/child-cancellation"
import { testEffect } from "./lib/effect"

const it = testEffect(childCancellationLayer)
const fixture = Effect.gen(function* () {
  const f = yield* childFixture
  const control = yield* JobControl.Service
  const locations = yield* LocationServiceMap.Service
  const shell = yield* Shell.Service.pipe(Effect.provide(locations.get(f.parent.location)))
  const info = yield* shell.create({
    command: process.platform === "win32" ? "Start-Sleep -Seconds 300" : "exec sleep 300",
  })
  yield* Effect.addFinalizer(() => shell.stop(info.id).pipe(Effect.ignore))
  yield* f.jobs.start({
    id: info.id,
    type: "shell",
    metadata: { sessionID: f.child.id },
    recovery: { kind: "shell", sessionID: f.parent.id, shellID: info.id, command: info.command },
    run: shell.wait(info.id).pipe(Effect.as("exited")),
  })
  yield* f.jobs.background(info.id)
  return { ...f, control, shell, info, input: { parentID: f.parent.id, jobID: info.id } }
})

it.live("refuses a mismatched persisted recovery owner before stopping a native shell", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const before = yield* f.jobs.pendingBackground
    expect(yield* f.control.cancel({ ...f.input, parentID: f.child.id }).pipe(Effect.flip)).toMatchObject({
      _tag: "Job.ParentMismatchError",
    })
    expect((yield* f.shell.get(f.info.id)).status).toBe("running")
    expect(yield* f.jobs.pendingBackground).toEqual(before)
    yield* f.control.cancel(f.input)
  }),
)

it.live("cancels a live native shell and waits for process exit and durable Job settlement", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const pid = f.info.pid
    if (pid === undefined) throw new Error("The real shell did not expose its process ID")
    expect(process.kill(pid, 0)).toBe(true)

    expect(yield* f.control.cancel(f.input)).toEqual({ status: "cancelled" })
    expect(() => process.kill(pid, 0)).toThrow()
    expect(yield* f.jobs.pendingBackground).toMatchObject([{ id: f.info.id, status: "cancelled" }])
    expect(yield* f.control.cancel(f.input)).toEqual({ status: "terminal", state: "cancelled" })
  }),
)

it.effect("preserves a finished native image Job as terminal", () =>
  Effect.gen(function* () {
    const f = yield* childFixture
    const control = yield* JobControl.Service
    yield* f.jobs.start({
      id: "image_finished",
      type: "image",
      recovery: {
        kind: "image",
        sessionID: f.parent.id,
        path: "/fixture/image.png",
        model: "test/image",
      },
      run: Effect.succeed("saved"),
    })
    yield* f.jobs.background("image_finished")
    yield* f.jobs.awaitIdle("image_finished")
    const before = yield* f.jobs.pendingBackground
    expect(yield* control.cancel({ parentID: f.parent.id, jobID: "image_finished" })).toEqual({
      status: "terminal",
      state: "completed",
    })
    expect(yield* f.jobs.pendingBackground).toEqual(before)
  }),
)

it.effect("returns requested while native image cleanup is still running and settles after the caller's deadline", () =>
  Effect.gen(function* () {
    const f = yield* childFixture
    const control = yield* JobControl.Service
    const cleaning = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
    yield* f.jobs.start({
      id: "image_slow_cleanup",
      type: "image",
      recovery: { kind: "image", sessionID: f.parent.id, path: "/fixture.png", model: "test/image" },
      run: Effect.never.pipe(
        Effect.ensuring(Deferred.succeed(cleaning, undefined).pipe(Effect.andThen(Deferred.await(release)))),
      ),
    })
    yield* f.jobs.background("image_slow_cleanup")
    const input = { parentID: f.parent.id, jobID: "image_slow_cleanup" }
    const request = yield* control.cancel(input).pipe(Effect.forkScoped)
    yield* Deferred.await(cleaning)
    yield* TestClock.adjust("1 second")
    expect(yield* Fiber.join(request)).toEqual({ status: "requested" })
    yield* Deferred.succeed(release, undefined)
    yield* f.jobs.awaitIdle(input.jobID)
    expect(yield* control.cancel(input)).toEqual({ status: "terminal", state: "cancelled" })
  }),
)

it.effect("requires session.cancelChild for directly owned subagent Jobs", () =>
  Effect.gen(function* () {
    const f = yield* childFixture
    yield* f.start()
    const control = yield* JobControl.Service
    expect(yield* control.cancel({ parentID: f.parent.id, jobID: f.child.id })).toEqual({
      status: "unsupported",
      reason: "Use session.cancelChild for subagent jobs",
    })
    expect((yield* f.jobs.get(f.child.id))?.status).toBe("running")
    yield* f.sessions.cancelChild(f.input)
  }),
)

it.effect("returns unsupported for an unowned durable native Job without changing durable state", () =>
  Effect.gen(function* () {
    const f = yield* childFixture
    const control = yield* JobControl.Service
    const db = (yield* Database.Service).db
    const recovery = { kind: "image", sessionID: f.parent.id, path: "/fixture/image.png", model: "test/image" } as const
    yield* db
      .insert(JobTable)
      .values({
        notification_id: SessionMessage.ID.create(),
        id: "image_remote",
        session_id: f.parent.id,
        kind: "image",
        status: "running",
        recovery,
      })
      .run()
      .pipe(Effect.orDie)
    const before = yield* f.jobs.pendingBackground
    expect(yield* control.cancel({ parentID: f.parent.id, jobID: "image_remote" })).toMatchObject({
      status: "unsupported",
    })
    expect(yield* f.jobs.pendingBackground).toEqual(before)
  }),
)

it.effect("lists only direct owners by default and includes the subtree only when requested", () =>
  Effect.gen(function* () {
    const f = yield* childFixture
    const control = yield* JobControl.Service
    const nested = yield* f.sessions.create({ parentID: f.child.id })
    const unrelated = yield* f.sessions.create({ location: f.parent.location })
    for (const [id, sessionID] of [
      ["root_job", f.parent.id],
      ["child_job", f.child.id],
      ["nested_job", nested.id],
      ["unrelated_job", unrelated.id],
    ] as const) {
      yield* f.jobs.start({
        id,
        type: "image",
        recovery: { kind: "image", sessionID, path: `/${id}.png`, model: "test/image" },
        run: Effect.never,
      })
      yield* f.jobs.background(id)
    }
    expect((yield* control.list({ parentSessionID: f.parent.id })).data.map((job) => job.id)).toEqual(["root_job"])
    expect(
      (yield* control.list({ parentSessionID: f.parent.id, descendants: false })).data.map((job) => job.id),
    ).toEqual(["root_job"])
    expect(
      (yield* control.list({ parentSessionID: f.parent.id, descendants: true })).data.map((job) => job.id),
    ).toEqual(["root_job", "child_job", "nested_job"])
  }),
)
