import { expect } from "bun:test"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { SessionExecution } from "@opencode/core/session/execution"
import { Cause, Deferred, Effect, Exit } from "effect"
import { testEffect } from "../lib/effect"
import { childCancellationLayer, childFixture } from "../fixture/child-cancellation"
import { host } from "./host"

const it = testEffect(childCancellationLayer)

it.live("Promise wait AbortSignal settles only the reader while the native child stays active", () =>
  Effect.gen(function* () {
    const fixture = yield* childFixture
    const release = yield* Deferred.make<void>()
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
    yield* fixture.start(Deferred.await(release))
    const entered = yield* Deferred.make<void>()
    const controller = new AbortController()
    let reader: Promise<void> | undefined
    const context = host({
      session: {
        wait: (input) =>
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(fixture.sessions.wait(input.sessionID))),
      },
    })
    yield* PluginPromise.fromPromise({
      id: "wait-signal-proof",
      async setup(ctx) {
        reader = ctx.session.wait({ sessionID: fixture.child.id }, { signal: controller.signal })
      },
    }).effect(context)
    if (reader === undefined) throw new Error("Missing native wait reader")
    const waiting = reader
    yield* Deferred.await(entered)
    controller.abort()
    const outcome = yield* Effect.tryPromise({ try: () => waiting, catch: (error) => error }).pipe(
      Effect.timeout("1 second"),
      Effect.exit,
    )
    const execution = yield* SessionExecution.Service
    expect(yield* execution.isActive(fixture.child.id)).toBe(true)
    expect(yield* fixture.jobs.get(fixture.child.id)).toMatchObject({ status: "running" })
    yield* Deferred.succeed(release, undefined)
    yield* execution.awaitIdle(fixture.child.id)
    if (!Exit.isFailure(outcome)) throw new Error("Cancelled reader resolved successfully")
    expect(Cause.squash(outcome.cause)).toMatchObject({ message: "All fibers interrupted without error" })
  }),
)
