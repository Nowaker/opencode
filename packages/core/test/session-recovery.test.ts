import { expect } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Money } from "@opencode/schema/money"
import { eq } from "drizzle-orm"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { EventSequenceTable } from "@opencode/core/event/sql"
import { Location } from "@opencode/core/location"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionInputRevision } from "@opencode/core/session/input-revision"
import { SessionRecovery } from "@opencode/core/session/recovery"
import { KVTable } from "@opencode/core/kv/sql"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)
const setup = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const location = yield* Location.Service
  const session = yield* sessions.create({ location: { directory: location.directory } })
  return { sessions, session, expected: yield* sessions.recovery({ sessionID: session.id }) }
})

for (const promoted of [false, true]) {
  it.live(`prepared admission reconciles an ID ${promoted ? "promoted" : "admitted"} after its first lookup`, () =>
    Effect.gen(function* () {
      const { sessions, session, expected } = yield* setup
      const db = (yield* Database.Service).db
      const bus = yield* Bus.Service
      const prepared = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const publishPrepared: Bus.Interface["publishPrepared"] = (definition, input) =>
        Deferred.succeed(prepared, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(bus.publishPrepared(definition, input)),
        )
      const delayed = yield* SessionInbox.make().pipe(Effect.provideService(Bus.Service, { ...bus, publishPrepared }))
      const admission = yield* SessionInbox.make()
      const id = SessionMessage.ID.create()
      const pending = yield* delayed
        .admit({
          id,
          sessionID: session.id,
          item: { type: "user", delivery: "steer", payload: { text: "loser" } },
          check: () => SessionRecovery.checkPrompt({ db, sessionID: session.id, expected, identity: () => null }),
        })
        .pipe(Effect.forkScoped)
      yield* Deferred.await(prepared)
      yield* admission.admit({
        id,
        sessionID: session.id,
        item: { type: "user", delivery: "steer", payload: { text: "winner" } },
      })
      if (promoted) yield* bus.publish(SessionEvent.InboxDelivered, { sessionID: session.id, inboxID: id })

      yield* Deferred.succeed(release, undefined)
      const reconciled = yield* Fiber.join(pending)

      expect(reconciled.payload.text).toBe("winner")
      expect((yield* sessions.inbox(session.id)).map((item) => item.id)).toEqual(promoted ? [] : [id])
    }),
  )
}

it.live("recovery observes the latest projected assistant and idle marker rather than the aggregate event head", () =>
  Effect.gen(function* () {
    const { sessions, session, expected } = yield* setup
    const bus = yield* Bus.Service
    const assistantMessageID = SessionMessage.ID.create()
    yield* bus.publish(SessionEvent.Step.Started, {
      sessionID: session.id,
      assistantMessageID,
      agent: Agent.ID.make("test"),
      model: { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") },
      started: 0,
    })
    yield* bus.publish(SessionEvent.Step.Ended, {
      sessionID: session.id,
      assistantMessageID,
      finish: "stop",
      cost: Money.USD.zero,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    const idle = yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: session.id })
    yield* sessions.rename({ sessionID: session.id, title: "later aggregate event" })

    expect(yield* sessions.recovery({ sessionID: session.id })).toEqual({
      ...expected,
      assistantMessageID,
      idleMessageID: SessionMessage.ID.fromEvent(idle.id),
      throughSeq: idle.durable.seq,
    })
  }),
)

it.live("conditional prompt admits once and reconciles pending and promoted retries before stale guards", () =>
  Effect.gen(function* () {
    const { sessions, session, expected } = yield* setup
    const bus = yield* Bus.Service
    const id = SessionMessage.ID.create()
    const input = { sessionID: session.id, id, text: "first", resume: false, experimental: { expected } }

    const first = yield* sessions.prompt(input)
    const pending = yield* sessions.prompt({ ...input, text: "ignored retry", delivery: "queue" })
    yield* bus.publish(SessionEvent.InboxDelivered, { sessionID: session.id, inboxID: id })
    const promoted = yield* sessions.prompt({ ...input, text: "ignored promoted retry" })

    expect(first.id).toBe(id)
    expect(pending.payload.text).toBe("first")
    expect(promoted.payload.text).toBe("first")
    expect((yield* sessions.messages({ sessionID: session.id })).filter((message) => message.id === id)).toHaveLength(1)
  }),
)

it.live("admit then cancel changes the revision and refuses an old ID without allocating an event", () =>
  Effect.gen(function* () {
    const { sessions, session } = yield* setup
    const db = (yield* Database.Service).db
    const input = { sessionID: session.id, id: SessionMessage.ID.create(), text: "cancel me", resume: false }
    yield* sessions.prompt(input)
    const expected = yield* sessions.recovery({ sessionID: session.id })
    yield* sessions.cancelInbox({ sessionID: session.id, inboxID: input.id })
    const before = yield* db
      .select()
      .from(EventSequenceTable)
      .where(eq(EventSequenceTable.aggregate_id, session.id))
      .get()

    const error = yield* sessions.prompt({ ...input, experimental: { expected } }).pipe(Effect.flip)

    expect(error).toMatchObject({
      _tag: "Session.PromptGuardError",
      accepted: false,
      reason: "input-changed",
      sessionID: session.id,
    })
    expect(yield* sessions.inbox(session.id)).toEqual([])
    expect(yield* sessions.messages({ sessionID: session.id })).toEqual([])
    expect(
      yield* db.select().from(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, session.id)).get(),
    ).toEqual(before)
    const fresh = yield* sessions.recovery({ sessionID: session.id })
    expect((yield* sessions.prompt({ ...input, experimental: { expected: fresh } })).id).toBe(input.id)
  }),
)

it.live("metadata and rename publications preserve the projected message head and allow conditional input", () =>
  Effect.gen(function* () {
    const { sessions, session, expected } = yield* setup
    yield* sessions.rename({ sessionID: session.id, title: "Renamed" })
    yield* sessions.setMetadata({ sessionID: session.id, metadata: { unrelated: true } })

    const admitted = yield* sessions.prompt({
      sessionID: session.id,
      text: "after metadata",
      resume: false,
      experimental: { expected },
    })

    expect(admitted.payload.text).toBe("after metadata")
    expect(expected.throughSeq).toBe(-1)
    expect(expected.inputRevision).not.toBeNull()
  }),
)

it.live("staged revert refuses conditional admission without deleting pending input or history", () =>
  Effect.gen(function* () {
    const { sessions, session } = yield* setup
    const bus = yield* Bus.Service
    const id = SessionMessage.ID.create()
    yield* sessions.prompt({ sessionID: session.id, id, text: "keep", resume: false })
    yield* bus.publish(SessionEvent.InboxDelivered, { sessionID: session.id, inboxID: id })
    const expected = yield* sessions.recovery({ sessionID: session.id })
    yield* bus.publish(SessionEvent.RevertEvent.Staged, { sessionID: session.id, revert: { messageID: id } })

    const error = yield* sessions
      .prompt({ sessionID: session.id, text: "refused", resume: false, experimental: { expected } })
      .pipe(Effect.flip)

    expect(error).toMatchObject({ _tag: "Session.PromptGuardError", reason: "idle-changed" })
    expect((yield* sessions.messages({ sessionID: session.id })).map((message) => message.id)).toEqual([id])
    expect((yield* sessions.get(session.id)).revert).toBeDefined()
  }),
)

it.live("matching and conflicting prompt IDs retain native type and Session conflict semantics", () =>
  Effect.gen(function* () {
    const { sessions, session, expected } = yield* setup
    const other = yield* sessions.create({ parentID: session.id })
    const id = SessionMessage.ID.create()
    yield* sessions.synthetic({ sessionID: session.id, id, text: "synthetic", resume: false })

    for (const sessionID of [session.id, other.id]) {
      const error = yield* sessions
        .prompt({ sessionID, id, text: "conflicting", resume: false, experimental: { expected } })
        .pipe(Effect.flip)
      expect(error).toMatchObject({ _tag: "Session.PromptConflictError", sessionID, messageID: id })
    }
  }),
)

it.live("input revision follows delivery changes and commit, and a recreated Session cannot match", () =>
  Effect.gen(function* () {
    const { sessions, session, expected } = yield* setup
    const db = (yield* Database.Service).db
    const bus = yield* Bus.Service
    const admission = yield* SessionInbox.make()
    const id = SessionMessage.ID.create()
    yield* sessions.prompt({ sessionID: session.id, id, text: "queued", delivery: "queue", resume: false })
    const queued = yield* SessionInputRevision.read(db, session.id)
    yield* admission.steer({ sessionID: session.id, id })
    const steered = yield* SessionInputRevision.read(db, session.id)
    yield* bus.publish(SessionEvent.InboxDelivered, { sessionID: session.id, inboxID: id })
    const delivered = yield* SessionInputRevision.read(db, session.id)
    yield* bus.publish(SessionEvent.RevertEvent.Committed, { sessionID: session.id, to: id })
    const reverted = yield* SessionInputRevision.read(db, session.id)
    expect(
      new Set([
        expected.inputRevision?.eventID,
        queued?.eventID,
        steered?.eventID,
        delivered?.eventID,
        reverted?.eventID,
      ]).size,
    ).toBe(5)

    yield* sessions.remove(session.id)
    expect(yield* SessionInputRevision.read(db, session.id)).toBeNull()
    yield* sessions.create({ id: session.id, location: session.location })
    expect((yield* sessions.recovery({ sessionID: session.id })).inputRevision?.eventID).not.toBe(
      expected.inputRevision?.eventID,
    )
    yield* db
      .delete(KVTable)
      .where(eq(KVTable.key, `opencode/session-input-revision/${session.id}`))
      .run()
    expect((yield* sessions.recovery({ sessionID: session.id })).inputRevision).toBeNull()
  }),
)

for (const predicate of ["idleMessageID", "throughSeq"] as const) {
  it.live(`conditional prompt compares the ${predicate} predicate`, () =>
    Effect.gen(function* () {
      const { sessions, session, expected } = yield* setup
      const stale =
        predicate === "throughSeq"
          ? { ...expected, throughSeq: expected.throughSeq + 1 }
          : { ...expected, idleMessageID: SessionMessage.ID.create() }

      const error = yield* sessions
        .prompt({
          sessionID: session.id,
          text: "stale history",
          resume: false,
          experimental: { expected: stale },
        })
        .pipe(Effect.flip)

      expect(error).toMatchObject({ _tag: "Session.PromptGuardError", accepted: false, reason: "idle-changed" })
      expect(yield* sessions.inbox(session.id)).toEqual([])
    }),
  )
}
