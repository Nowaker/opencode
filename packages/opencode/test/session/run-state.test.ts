import { expect } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Session } from "@/session/session"
import { SessionAbort } from "@/session/abort"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { MessageV2 } from "@/session/message-v2"
import { MessageID } from "@/session/schema"
import { InstanceStore } from "@/project/instance-store"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([
    Session.node,
    MessageV2.node,
    SessionProjector.node,
    SessionRunState.node,
    SessionStatus.node,
    EventV2.node,
    Database.node,
  ])),
)

const setup = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const session = yield* sessions.create({})
  const info = yield* sessions.createMessage({
    id: MessageID.ascending(),
    sessionID: session.id,
    role: "user",
    time: { created: 1 },
    agent: "build",
    model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
  })
  return { session, message: { info, parts: [] } satisfies SessionV1.WithParts }
})

it.instance("replacement work retains its owner and abort metadata while prior cancellation settles", () =>
  Effect.gen(function* () {
    const runners = yield* SessionRunState.Service
    const status = yield* SessionStatus.Service
    const { session, message } = yield* setup
    const firstStarted = yield* Deferred.make<void>()
    const firstInterrupted = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const secondStarted = yield* Deferred.make<void>()
    const firstMetadata = yield* Deferred.make<SessionAbort.Metadata | undefined>()
    const secondMetadata = yield* Deferred.make<SessionAbort.Metadata | undefined>()
    yield* Effect.gen(function* () {
      const first = yield* runners
        .ensureRunning(
          session.id,
          Effect.succeed(message),
          Deferred.succeed(firstStarted, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              Effect.gen(function* () {
                yield* Deferred.succeed(firstInterrupted, undefined)
                yield* Deferred.await(release)
                yield* Deferred.succeed(firstMetadata, yield* SessionAbort.metadata)
              }),
            ),
          ),
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(firstStarted)
      const stop = yield* runners.cancel(session.id, { requester: "tui" }).pipe(Effect.forkChild)
      yield* Deferred.await(firstInterrupted)
      yield* runners.cancel(session.id, { requester: "tui-revert" })

      const second = yield* runners
        .ensureRunning(
          session.id,
          Effect.succeed(message),
          Effect.gen(function* () {
            yield* status.set(session.id, { type: "busy" })
            yield* Deferred.succeed(secondStarted, undefined)
            return yield* Effect.never
          }).pipe(
            Effect.onInterrupt(() =>
              Effect.flatMap(SessionAbort.metadata, (metadata) => Deferred.succeed(secondMetadata, metadata)),
            ),
          ),
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(secondStarted)
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(stop)
      yield* Fiber.join(first)
      expect(yield* Deferred.await(firstMetadata)).toEqual({ cause: "cancel", requester: "tui" })
      expect((yield* runners.assertNotBusy(session.id).pipe(Effect.result))._tag).toBe("Failure")
      expect((yield* status.get(session.id)).type).toBe("busy")

      yield* runners.cancel(session.id, { requester: "api" })
      yield* Fiber.join(second)
      expect(yield* Deferred.await(secondMetadata)).toEqual({ cause: "cancel", requester: "api" })
      yield* runners.assertNotBusy(session.id)
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))
  }),
)

it.instance("idle cancellation and previous requester do not leak into a disposed replacement", () =>
  Effect.gen(function* () {
    const runners = yield* SessionRunState.Service
    const store = yield* InstanceStore.Service
    const { directory } = yield* TestInstance
    const { session, message } = yield* setup
    yield* runners.cancel(session.id, { requester: "tui" })
    yield* runners.ensureRunning(session.id, Effect.succeed(message), Effect.succeed(message))
    const started = yield* Deferred.make<void>()
    const metadata = yield* Deferred.make<SessionAbort.Metadata | undefined>()
    const running = yield* runners
      .ensureRunning(
        session.id,
        Effect.succeed(message),
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() =>
            Effect.flatMap(SessionAbort.metadata, (value) => Deferred.succeed(metadata, value)),
          ),
        ),
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(started)
    yield* store.disposeDirectory(directory, "api")
    yield* Fiber.await(running)
    expect(yield* Deferred.await(metadata)).toEqual({ cause: "dispose", dispose: "api" })
  }),
)

for (const first of ["cancel", "dispose"] as const) {
  it.instance(`${first} retains abort ownership when cancellation and disposal overlap`, () =>
    Effect.gen(function* () {
      const runners = yield* SessionRunState.Service
      const store = yield* InstanceStore.Service
      const { directory } = yield* TestInstance
      const { session, message } = yield* setup
      const started = yield* Deferred.make<void>()
      const interrupted = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const metadata = yield* Deferred.make<SessionAbort.Metadata | undefined>()
      yield* Effect.gen(function* () {
        const running = yield* runners
          .ensureRunning(
            session.id,
            Effect.succeed(message),
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() =>
                Effect.gen(function* () {
                  yield* Deferred.succeed(interrupted, undefined)
                  yield* Deferred.await(release)
                  yield* Deferred.succeed(metadata, yield* SessionAbort.metadata)
                }),
              ),
            ),
          )
          .pipe(Effect.forkChild)
        yield* Deferred.await(started)
        const cancel = runners.cancel(session.id, { requester: "tui" })
        const dispose = store.disposeDirectory(directory, "api")
        const initial = yield* (first === "cancel" ? cancel : dispose).pipe(Effect.forkChild)
        yield* Deferred.await(interrupted)
        const competing = yield* (first === "cancel" ? dispose : cancel).pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* Deferred.succeed(release, undefined)
        yield* Effect.all([Fiber.await(initial), Fiber.await(competing), Fiber.await(running)])
        expect(yield* Deferred.await(metadata)).toEqual(
          first === "cancel" ? { cause: "cancel", requester: "tui" } : { cause: "dispose", dispose: "api" },
        )
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))
    }),
  )
}
