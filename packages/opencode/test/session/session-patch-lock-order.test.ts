import { expect } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { LiveEvents } from "@/session/live-events"
import { Session } from "@/session/session"
import { awaitWithTimeout } from "../lib/effect"
import { Feed, it, snapshot } from "./live-events.fixture"

it.instance("a metadata patch waiting for a live snapshot leaves SQLite available to the snapshot", () =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    const live = yield* LiveEvents.Service
    const feed = yield* Feed
    const target = yield* session.create({ metadata: { label: "before patch" } })
    const sibling = yield* session.create({ title: "before snapshot" })
    const snapshotEntered = yield* Deferred.make<void>()
    const patchAtGate = yield* Deferred.make<void>()

    const capture = yield* live.open({ sessionID: target.id }, Effect.gen(function* () {
      yield* Deferred.succeed(snapshotEntered, undefined)
      yield* awaitWithTimeout(Deferred.await(patchAtGate), "metadata patch did not reach the live gate", "5 seconds")
      // On a lock inversion, fail inside the snapshot so it releases the gate before joining the writer.
      const current = yield* awaitWithTimeout(session.get(target.id), "live snapshot was blocked by the patch's SQLite writer", "5 seconds")
      expect(current.metadata?.label).toBe("before patch")
      yield* session.setTitle({ sessionID: sibling.id, title: "snapshot wrote through SQLite" })
      return yield* snapshot(target.id)
    })).pipe(Effect.tap((attachment) => Effect.sync(attachment.close)), Effect.forkChild)
    yield* awaitWithTimeout(Deferred.await(snapshotEntered), "live snapshot did not enter its read effect", "5 seconds")

    feed.beforeGuard = () => Deferred.succeed(patchAtGate, undefined).pipe(Effect.asVoid)
    const patch = yield* session.setMetadata({ sessionID: target.id, metadata: { label: "after patch" } }).pipe(Effect.forkChild)
    yield* Fiber.join(capture)
    yield* Fiber.join(patch)

    expect((yield* session.get(target.id)).metadata?.label).toBe("after patch")
    expect((yield* session.get(sibling.id)).title).toBe("snapshot wrote through SQLite")
  }),
  20_000,
)
