import { expect, test } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { eq } from "drizzle-orm"
import { MachineProvenance } from "@opencode-ai/schema/machine-provenance"
import { Session } from "@/session/session"
import { SessionRunState } from "@/session/run-state"
import { MessageV2 } from "@/session/message-v2"
import { MessageID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Session.node, MessageV2.node, SessionProjector.node, SessionRunState.node, EventV2.node, Database.node])))
const model = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") }

for (const stamped of [true, false]) {
  it.instance(`preserves ${stamped ? "creator A" : "unknown creator"} when B reuses a message ID`, () => identity(Effect.gen(function* () {
    const sessions = yield* Session.Service
    const session = yield* sessions.create({})
    const input: SessionV1.User = { id: MessageID.ascending(), sessionID: session.id, role: "user", time: { created: 1 }, agent: "build", model }
    const original = yield* (stamped ? sessions.createMessage(structuredClone(input)) : sessions.updateMessage(input))
    const creator = structuredClone(original.vibeterm?.creator)
    process.env.VIBETERM_MACHINE_ID = "machine-B"

    const replayed = yield* sessions.createMessage({ ...input, agent: "plan", time: { created: 2 } })

    const stored = yield* MessageV2.get({ sessionID: session.id, messageID: input.id })
    expect(stored.info.vibeterm?.creator).toEqual(creator)
    expect(replayed.vibeterm?.creator).toEqual(creator)
    expect(stored.info.agent).toBe("plan")
  })))
}

it.instance("preserves external metadata when a stale engine event projects", () => identity(Effect.gen(function* () {
  const sessions = yield* Session.Service
  const events = yield* EventV2.Service
  const database = yield* Database.Service
  const note = { id: "note", text: "old", author: "human", createdAt: 1, updatedAt: 1 }
  const session = yield* sessions.create({ metadata: { external: { retained: false }, vibeterm: { creator: { machineId: "stale" }, notes: [note], sibling: "old" } } })
  const stale = structuredClone(session)
  const creator = { objectId: session.id, machineId: "external", source: "stamped" }
  const tombstone = { ...note, updatedAt: 2, deletedAt: 2 }
  const added = { ...note, id: "added", text: "new", updatedAt: 3 }
  yield* database.db.update(SessionTable).set({ metadata: {
    external: { retained: true },
    vibeterm: { creator, notes: [tombstone, added], sibling: "external", other: true },
  } }).where(eq(SessionTable.id, session.id)).run().pipe(Effect.orDie)

  yield* events.publish(SessionV1.Event.Updated, { sessionID: session.id, info: { ...stale, title: "engine update" } })

  const stored = yield* sessions.get(session.id)
  expect(stored.title).toBe("engine update")
  expect(stored.metadata).toMatchObject({ external: { retained: true }, vibeterm: { creator, notes: [added, tombstone], sibling: "external", other: true } })
})))

it.instance("preserves persisted creator when a streamed update omits provenance", () => identity(Effect.gen(function* () {
  const sessions = yield* Session.Service
  const session = yield* sessions.create({})
  const input: SessionV1.User = { id: MessageID.ascending(), sessionID: session.id, role: "user", time: { created: 1 }, agent: "build", model }
  const original = yield* sessions.createMessage(structuredClone(input))
  const creator = structuredClone(original.vibeterm?.creator)
  process.env.VIBETERM_MACHINE_ID = "machine-B"

  yield* sessions.updateMessage({ ...input, agent: "plan" })

  expect((yield* MessageV2.get({ sessionID: session.id, messageID: input.id })).info.vibeterm?.creator).toEqual(creator)
})))

test("merges incoming newer notes while retaining local ties and tombstones", () => {
  const note = { id: "one", createdAt: 1, updatedAt: 1, text: "old" }
  const deleted = { ...note, updatedAt: 2, deletedAt: 2 }
  const incoming = { vibeterm: { notes: [{ ...note, updatedAt: 2, text: "tie" }, { ...note, id: "two", updatedAt: 3, text: "new" }] } }
  const current = { vibeterm: { notes: [deleted, { ...note, id: "two" }] } }

  const merged = MachineProvenance.mergeMetadata("session", incoming, current)

  expect(merged?.vibeterm).toMatchObject({ notes: [deleted, { ...note, id: "two", updatedAt: 3, text: "new" }] })
})

function identity<A, E, R>(work: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env.VIBETERM_MACHINE_ID
      process.env.VIBETERM_MACHINE_ID = "machine-A"
      return previous
    }),
    () => work,
    (previous) => Effect.sync(() => {
      if (previous === undefined) delete process.env.VIBETERM_MACHINE_ID
      else process.env.VIBETERM_MACHINE_ID = previous
    }),
  )
}

it.instance("preserves creator A through assistant streaming, import and fork on B", () => identity(Effect.gen(function* () {
  const sessions = yield* Session.Service
  const session = yield* sessions.create({})
  const user = yield* sessions.createMessage({ id: MessageID.ascending(), sessionID: session.id, role: "user", time: { created: 1 }, agent: "build", model })
  const assistant: SessionV1.Assistant = yield* sessions.createMessage({
    id: MessageID.ascending(), sessionID: session.id, role: "assistant", time: { created: 2 }, agent: "build",
    parentID: user.id, modelID: model.modelID, providerID: model.providerID, mode: "build",
    path: { cwd: "/fixture", root: "/fixture" }, cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })
  const creator = structuredClone(assistant.vibeterm?.creator)
  process.env.VIBETERM_MACHINE_ID = "machine-B"
  assistant.tokens.output = 42
  assistant.time.completed = 3
  yield* sessions.updateMessage(assistant)
  const imported = yield* sessions.updateMessage({ ...user, id: MessageID.ascending(), vibeterm: undefined })
  const fork = yield* sessions.fork({ sessionID: session.id })
  const stored = yield* MessageV2.get({ sessionID: session.id, messageID: assistant.id })
  const copies = yield* sessions.messages({ sessionID: fork.id })
  const copiedAssistant = copies.find((message) => message.info.role === "assistant")
  expect(stored.info.vibeterm?.creator).toEqual(creator)
  expect(imported.vibeterm).toBeUndefined()
  expect(copiedAssistant?.info.vibeterm?.creator).toMatchObject({ machineId: "machine-A", objectId: copiedAssistant?.info.id, originalObjectId: assistant.id, at: 2 })
})))

it.instance("stamps only admitted work, keeps joined runner execution and clears fork execution", () => identity(Effect.gen(function* () {
  const sessions = yield* Session.Service
  const runners = yield* SessionRunState.Service
  const session = yield* sessions.create({})
  const message = { info: yield* sessions.createMessage({ id: MessageID.ascending(), sessionID: session.id, role: "user", time: { created: 1 }, agent: "build", model }), parts: [] }
  const started = yield* Deferred.make<void>()
  const release = yield* Deferred.make<void>()
  const work = Effect.gen(function* () {
    yield* Deferred.succeed(started, undefined)
    yield* Deferred.await(release)
    return message
  })
  const first = yield* runners.ensureRunning(session.id, Effect.succeed(message), work).pipe(Effect.forkChild)
  yield* Deferred.await(started)
  const stamp = (yield* sessions.get(session.id)).metadata?.vibeterm.lastExecution
  process.env.VIBETERM_MACHINE_ID = "machine-B"
  const joined = yield* runners.ensureRunning(session.id, Effect.succeed(message), Effect.die("joined work must not run")).pipe(Effect.forkChild)
  yield* Effect.yieldNow
  yield* Deferred.succeed(release, undefined)
  yield* Fiber.join(first)
  yield* Fiber.join(joined)
  expect((yield* sessions.get(session.id)).metadata?.vibeterm.lastExecution).toEqual(stamp)
  expect(stamp).toMatchObject({ sessionId: session.id, machineId: "machine-A" })
  const fork = yield* sessions.fork({ sessionID: session.id })
  expect(fork.metadata?.vibeterm.lastExecution).toBeUndefined()
  yield* runners.ensureRunning(session.id, Effect.succeed(message), Effect.succeed(message))
  expect((yield* sessions.get(session.id)).metadata?.vibeterm.lastExecution.machineId).toBe("machine-B")
})))

test("merges by total execution order and ignores foreign session projections", () => {
  const base = { sessionId: "s", machineId: "A", machine: null, hostname: null, platform: "linux", at: 10, executionId: "a" }
  expect(MachineProvenance.latest("s", base, { ...base, machineId: "B" })?.machineId).toBe("B")
  expect(MachineProvenance.latest("s", { ...base, executionId: "b" }, { ...base, at: 9, executionId: "z" })?.executionId).toBe("b")
  expect(MachineProvenance.mergeMetadata("s", { vibeterm: { lastExecution: { ...base, sessionId: "other", at: 99 } } }, { vibeterm: { lastExecution: base } })?.vibeterm).toEqual({ lastExecution: base })
})

it.instance("retains newer execution through stale and foreign metadata projection", () => identity(Effect.gen(function* () {
  const sessions = yield* Session.Service
  const session = yield* sessions.create({})
  yield* sessions.recordExecution(session.id)
  const stamp = (yield* sessions.get(session.id)).metadata?.vibeterm.lastExecution
  yield* sessions.setMetadata({ sessionID: session.id, metadata: { unrelated: true, vibeterm: { lastExecution: { ...stamp, sessionId: "foreign", at: stamp.at + 100 } } } })
  expect((yield* sessions.get(session.id)).metadata).toMatchObject({ unrelated: true, vibeterm: { lastExecution: stamp } })
})))

it.instance("stays inert without persistent identity even on new creation and execution", () => identity(Effect.gen(function* () {
  delete process.env.VIBETERM_MACHINE_ID
  const sessions = yield* Session.Service
  const session = yield* sessions.create({})
  yield* sessions.createMessage({ id: MessageID.ascending(), sessionID: session.id, role: "user", time: { created: 1 }, agent: "build", model })
  yield* sessions.recordExecution(session.id)
  expect((yield* sessions.messages({ sessionID: session.id }))[0]?.info.vibeterm).toBeUndefined()
  expect((yield* sessions.get(session.id)).metadata).toBeUndefined()
})))

it.instance("stamps admitted shell once and refuses busy shell without stamping", () => identity(Effect.gen(function* () {
  const sessions = yield* Session.Service
  const runners = yield* SessionRunState.Service
  const session = yield* sessions.create({})
  const message = { info: yield* sessions.createMessage({ id: MessageID.ascending(), sessionID: session.id, role: "user", time: { created: 1 }, agent: "build", model }), parts: [] }
  const started = yield* Deferred.make<void>()
  const release = yield* Deferred.make<void>()
  const shell = yield* runners.startShell(session.id, Effect.succeed(message), Effect.gen(function* () {
    yield* Deferred.succeed(started, undefined)
    yield* Deferred.await(release)
    return message
  })).pipe(Effect.forkChild)
  yield* Deferred.await(started)
  const stamp = (yield* sessions.get(session.id)).metadata?.vibeterm.lastExecution
  process.env.VIBETERM_MACHINE_ID = "machine-B"
  const rejected = yield* runners.startShell(session.id, Effect.succeed(message), Effect.succeed(message)).pipe(Effect.result)
  expect(rejected._tag).toBe("Failure")
  expect((yield* sessions.get(session.id)).metadata?.vibeterm.lastExecution).toEqual(stamp)
  yield* Deferred.succeed(release, undefined)
  yield* Fiber.join(shell)
})))
