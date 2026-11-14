import { expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { Event } from "@opencode/schema/event"
import { Location } from "@opencode/schema/location"
import { AbsolutePath } from "@opencode/schema/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { testEffect } from "./lib/effect"
import { tmpdirScoped } from "./fixture/tmpdir"

const it = testEffect(Layer.empty)

for (const guarded of [false, true]) {
  it.effect(
    `public ${guarded ? "guarded" : "unguarded"} interruption retains accepted continuation after caller cancellation`,
    () =>
      Effect.gen(function* () {
        const accepted = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const execution = makeGlobalNode({
          service: SessionExecution.Service,
          layer: Layer.effect(
            SessionExecution.Service,
            Effect.gen(function* () {
              const database = yield* Database.Service
              const bus = yield* Bus.Service
              return SessionExecution.Service.of({
                identity: () => null,
                active: Effect.succeed(new Set<Session.ID>()),
                isActive: () => Effect.succeed(false),
                resume: () => Effect.void,
                wake: () => Effect.void,
                awaitIdle: () => Effect.void,
                interrupt: (sessionID) =>
                  Deferred.succeed(accepted, undefined).pipe(
                    Effect.andThen(Deferred.await(release)),
                    Effect.andThen(SessionInbox.promote(database.db, bus, sessionID, "steer")),
                    Effect.as(true),
                  ),
              })
            }),
          ),
          deps: [Database.node, Bus.node],
        })
        const layer = AppNodeBuilder.build(LayerNode.group([Session.node, SessionInbox.node]), [
          SessionExecution.node.replace(execution),
        ])
        yield* Effect.gen(function* () {
          const sessions = yield* Session.Service
          const admission = yield* SessionInbox.Service
          const directory = yield* tmpdirScoped()
          const session = yield* sessions.create({
            location: Location.Ref.make({ directory: AbsolutePath.make(directory.path) }),
          })
          const queued = yield* admission.admit({
            id: SessionMessage.ID.create(),
            sessionID: session.id,
            item: { type: "user", delivery: "queue", payload: { text: "keep queued" } },
          })
          yield* admission.admit({
            id: SessionMessage.ID.create(),
            sessionID: session.id,
            item: { type: "user", delivery: "steer", payload: { text: "continue steering" } },
          })
          const caller = yield* sessions
            .interrupt(session.id, {
              resume: true,
              ...(guarded
                ? { experimental: { expected: { executionID: Event.ID.create(), inputRevision: null } } }
                : {}),
            })
            .pipe(Effect.forkChild({ startImmediately: true }))
          yield* Deferred.await(accepted)
          const cancellation = yield* Fiber.interrupt(caller).pipe(Effect.forkChild({ startImmediately: true }))
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(cancellation)
          expect(yield* admission.list(session.id)).toEqual([queued])
          expect(
            (yield* sessions.messages({ sessionID: session.id }))
              .filter((message) => message.type === "user")
              .map((message) => message.text),
          ).toEqual(["continue steering"])
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.provide(layer))
      }),
  )
}
