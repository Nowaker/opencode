import { expect } from "bun:test"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { Instance } from "@opencode/core/instance/service"
import { Job } from "@opencode/core/job"
import { JobControl } from "@opencode/core/job/control"
import { JobTable } from "@opencode/core/job/sql"
import { SessionStore } from "@opencode/core/session/store"
import { SessionMessage } from "@opencode/core/session/message"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { childCancellationLayer, childFixture } from "./fixture/child-cancellation"
import { observedJobControl } from "./fixture/job-results"
import { testEffect } from "./lib/effect"

const it = testEffect(childCancellationLayer)

it.effect("reads a running owned Job without waiting and refuses the foreign parent", () =>
  Effect.gen(function* () {
    const f = yield* childFixture
    yield* f.start()
    const control = yield* JobControl.Service
    const input = { parentID: f.parent.id, jobID: f.child.id }
    expect(yield* control.result(input)).toMatchObject({
      id: f.child.id,
      sessionID: f.parent.id,
      kind: "subagent",
      childSessionID: f.child.id,
      agent: "general",
      status: "running",
      description: "Cancellation fixture",
    })
    const observed = yield* observedJobControl
    for (const wait of [false, true]) {
      expect(yield* observed.control.result({ ...input, parentID: f.child.id, wait }).pipe(Effect.flip)).toMatchObject({
        _tag: "Job.ParentMismatchError",
      })
    }
    expect(yield* Deferred.isDone(observed.read)).toBe(false)
    expect(yield* Deferred.isDone(observed.wait)).toBe(false)
    expect((yield* f.jobs.get(f.child.id))?.status).toBe("running")
    yield* f.sessions.cancelChild(f.input)
  }),
)

for (const outcome of ["completed", "error", "cancelled"] as const) {
  it.effect(`returns actual native ${outcome} output and identity without consuming its result`, () =>
    Effect.gen(function* () {
      const f = yield* childFixture
      const control = yield* JobControl.Service
      const release = yield* Deferred.make<string, Error>()
      yield* f.jobs.start({
        id: "native_result",
        type: "image",
        title: "Native result",
        recovery: { kind: "image", sessionID: f.parent.id, path: "/native.png", model: "test/image" },
        run: Deferred.await(release),
      })
      yield* f.jobs.background("native_result")
      if (outcome === "completed") yield* Deferred.succeed(release, "native output\n")
      if (outcome === "error") yield* Deferred.fail(release, new Error("native failure"))
      if (outcome === "cancelled") yield* f.jobs.cancel("native_result")
      const input = { parentID: f.parent.id, jobID: "native_result", wait: true }
      const result = yield* control.result(input)
      expect(result).toMatchObject({
        id: "native_result",
        sessionID: f.parent.id,
        kind: "image",
        status: outcome,
        path: "/native.png",
        model: "test/image",
        title: "Native result",
      })
      expect(result.output).toBe(outcome === "completed" ? "native output\n" : undefined)
      expect(result.error).toBe(outcome === "error" ? "native failure" : undefined)
      expect(result.time.completed).toBeDefined()
      expect(yield* control.result(input)).toEqual(result)
    }),
  )
}

it.effect("interrupts only the result waiter and lets the native Job complete afterward", () =>
  Effect.gen(function* () {
    const f = yield* childFixture
    const control = yield* JobControl.Service
    const release = yield* Deferred.make<string>()
    const interrupted = yield* Deferred.make<void>()
    yield* f.jobs.start({
      id: "held_result",
      type: "image",
      recovery: { kind: "image", sessionID: f.parent.id, path: "/held.png", model: "test/image" },
      run: Deferred.await(release).pipe(Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))),
    })
    yield* f.jobs.background("held_result")
    const input = { parentID: f.parent.id, jobID: "held_result", wait: true }
    const observed = yield* observedJobControl
    const waiter = yield* observed.control.result(input).pipe(Effect.forkChild({ startImmediately: true }))
    yield* Deferred.await(observed.wait)
    yield* Fiber.interrupt(waiter)
    expect(yield* Deferred.isDone(interrupted)).toBe(false)
    expect((yield* f.jobs.get(input.jobID))?.status).toBe("running")
    yield* Deferred.succeed(release, "finished after waiter interruption")
    expect(yield* control.result(input)).toMatchObject({
      status: "completed",
      output: "finished after waiter interruption",
    })
  }),
)

it.effect("reads a retained durable terminal outcome with a new native Job service", () =>
  Effect.gen(function* () {
    const f = yield* childFixture
    yield* f.jobs.start({
      id: "persisted_result",
      type: "image",
      recovery: { kind: "image", sessionID: f.parent.id, path: "/persisted.png", model: "test/image" },
      run: Effect.succeed("persisted output"),
    })
    yield* f.jobs.background("persisted_result")
    yield* f.jobs.wait({ id: "persisted_result" })
    const database = yield* Database.Service
    const store = yield* SessionStore.Service
    const instance = yield* Instance.Service
    const fresh = AppNodeBuilder.build(LayerNode.group([JobControl.node, Job.node]), [
      Database.node.replace(Layer.succeed(Database.Service, database)),
      SessionStore.node.replace(Layer.succeed(SessionStore.Service, store)),
      Instance.node.replace(Layer.succeed(Instance.Service, instance)),
    ])
    const result = yield* Effect.gen(function* () {
      const jobs = yield* Job.Service
      expect(yield* jobs.get("persisted_result")).toBeUndefined()
      const control = yield* JobControl.Service
      return yield* control.result({ parentID: f.parent.id, jobID: "persisted_result", wait: true })
    }).pipe(Effect.provide(Layer.fresh(fresh)))
    expect(result).toMatchObject({
      id: "persisted_result",
      kind: "image",
      status: "completed",
      output: "persisted output",
      path: "/persisted.png",
    })
  }),
)

it.effect("refuses waiting for an unmatched durable owner and expires with native storage", () =>
  Effect.gen(function* () {
    const f = yield* childFixture
    const control = yield* JobControl.Service
    const db = (yield* Database.Service).db
    const notificationID = SessionMessage.ID.create()
    yield* db
      .insert(JobTable)
      .values({
        id: "remote_result",
        notification_id: notificationID,
        session_id: f.parent.id,
        kind: "shell",
        status: "running",
        recovery: { kind: "shell", sessionID: f.parent.id, shellID: "shell_remote", command: "remote command" },
      })
      .run()
      .pipe(Effect.orDie)
    const input = { parentID: f.parent.id, jobID: "remote_result" }
    expect(yield* control.result(input)).toMatchObject({
      status: "running",
      shellID: "shell_remote",
      command: "remote command",
    })
    expect(yield* control.result({ ...input, wait: true }).pipe(Effect.flip)).toMatchObject({
      _tag: "Job.WaitUnavailableError",
    })
    yield* f.jobs.completeBackground(notificationID)
    expect(yield* control.result(input).pipe(Effect.flip)).toMatchObject({ _tag: "Job.NotFoundError" })
  }),
)
