import { expect } from "bun:test"
import { Database } from "@opencode/core/database/database"
import { EngineStop } from "@opencode/core/engine-stop"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { ProjectTable } from "@opencode/core/project/sql"
import { SessionInbox } from "@opencode/core/session/inbox"
import { AbsolutePath } from "@opencode/schema/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Cause, Deferred, Effect, Exit, Fiber, Tracer } from "effect"
import { forceInput, seal } from "./fixture/engine-stop"
import { owner, ownerGraph, ownerReplacements } from "./fixture/engine-stop-owner"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([ownerGraph, EngineStop.node, SessionInbox.node]), ownerReplacements))

it.live("refuses a sealed move before destination project preparation or durable handoff", () =>
  Effect.gen(function* () {
    const s = yield* owner
    const claims = yield* EngineStop.Service
    const database = yield* Database.Service
    const inbox = yield* SessionInbox.Service
    const destination = yield* tmpdirScoped()
    const projects = yield* database.db.select().from(ProjectTable).all()
    const before = yield* s.sequence
    expect((yield* seal(claims)).status).toBe("sealed")
    const result = yield* s.sessions.move({
      sessionID: s.sessionID, directory: AbsolutePath.make(destination.path),
    }).pipe(Effect.exit)
    expect(Exit.isFailure(result) ? Cause.squash(result.cause) : result).toMatchObject({
      _tag: "EngineStop.RefusedError", admission: { status: "not-admitted" },
    })
    expect(yield* database.db.select().from(ProjectTable).all()).toEqual(projects)
    expect(yield* s.sequence).toBe(before)
    expect(yield* inbox.list(s.sessionID)).toEqual([])
  }),
)

it.live("interrupts a move waiting for the inbox lock under force without admitting it", () =>
  Effect.gen(function* () {
    const s = yield* owner
    const claims = yield* EngineStop.Service
    const inbox = yield* SessionInbox.Service
    const destination = yield* tmpdirScoped()
    const before = yield* s.sequence
    const locked = yield* Deferred.make<void>()
    const held = yield* Deferred.make<void>()
    // The move's last step before the inbox lock is sourceUnavailable. Its span ends on the move's own fiber, and
    // this fiber resumes only once the move suspends again, which is on the held lock.
    const reached = Deferred.makeUnsafe<void>()
    const tracer = Tracer.make({
      span(options) {
        const span = new Tracer.NativeSpan(options)
        if (options.name !== "SessionMove.sourceUnavailable") return span
        const end = span.end.bind(span)
        span.end = (time, exit) => {
          end(time, exit)
          Deferred.doneUnsafe(reached, Exit.void)
        }
        return span
      },
    })
    const holder = yield* SessionInbox.serialized(
      s.sessionID,
      Deferred.succeed(locked, undefined).pipe(Effect.andThen(Deferred.await(held))),
    ).pipe(Effect.forkScoped)
    yield* Deferred.await(locked)
    const moving = yield* s.sessions.move({ sessionID: s.sessionID, directory: AbsolutePath.make(destination.path) })
      .pipe(Effect.provideService(Tracer.Tracer, tracer), Effect.forkScoped)
    // Scope finalizers run newest first: free the lock before the scope interrupts the move, so a move that holds
    // its lock wait uninterruptibly (the broad mutant) fails by assertion instead of hanging teardown.
    yield* Effect.addFinalizer(() => Deferred.succeed(held, undefined))
    yield* Deferred.await(reached)
    const operation = yield* forceInput(claims).pipe(Effect.flatMap(claims.prepare))
    expect((yield* claims.awaitOperation(operation.operationID, 5_000)).status,
      "force seals while the move waits for the inbox lock").toBe("sealed")
    expect(Exit.isSuccess(yield* Fiber.await(moving)), "the waiting move did not complete").toBe(false)
    yield* Deferred.succeed(held, undefined)
    yield* Fiber.join(holder)
    expect(yield* inbox.list(s.sessionID)).toEqual([])
    expect(yield* s.sequence).toBe(before)
  }),
)
