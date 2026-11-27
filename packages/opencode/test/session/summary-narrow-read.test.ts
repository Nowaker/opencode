import { expect, spyOn } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Session } from "@/session/session"
import { SessionSummary } from "@/session/summary"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID } from "@/session/schema"
import { Snapshot } from "@/snapshot"
import { TestInstance } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([Session.node, SessionSummary.node, Snapshot.node, SessionProjector.node, MessageV2.node])),
)
const model = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") }
const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
const historicalPatch = "sentinel-history-patch"
const unrelatedPart = "sentinel-unrelated-part"
const replyOutput = "sentinel-reply-output"

function observeSqlitePayloads<A, E, R>(work: Effect.Effect<A, E, R>, sentinels: readonly string[]) {
  return Effect.gen(function* () {
    const database = yield* Database.Service
    const materialized = new Set<string>()
    const observe = (cells: readonly unknown[]) => {
      for (const cell of cells) {
        if (typeof cell !== "string") continue
        for (const sentinel of sentinels) if (cell.includes(sentinel)) materialized.add(sentinel)
      }
    }
    // Observe real results before Drizzle maps or decodes them, not the query text.
    const client = database.db.$client
    const execute = client.unsafe
    return yield* Effect.acquireUseRelease(
      Effect.sync(() =>
        spyOn(client, "unsafe").mockImplementation(<Row extends object>(sql: string, params?: readonly unknown[]) =>
          new Proxy(execute<Row>(sql, params), {
            get(target, key) {
              if (key === "values") {
                return target.values.pipe(Effect.tap((rows) => Effect.sync(() => rows.forEach(observe))))
              }
              if (key === "withoutTransform") {
                return target.withoutTransform.pipe(
                  Effect.tap((rows) => Effect.sync(() => rows.forEach((row) => observe(Object.values(row))))),
                )
              }
              return Reflect.get(target, key)
            },
          }),
        ),
      ),
      () => Effect.map(work, (result) => ({ result, materialized: [...materialized] })),
      (probe) => Effect.sync(() => probe.mockRestore()),
    )
  })
}

const turn = Effect.fnUntraced(function* () {
  const sessions = yield* Session.Service
  const session = yield* sessions.create({})
  const base = { sessionID: session.id, role: "user" as const, agent: "build", model }
  const user = yield* sessions.updateMessage({
    ...base,
    id: MessageID.ascending(),
    time: { created: 1 },
    summary: {
      title: "saved title",
      body: "saved body",
      diffs: [{ file: '"a\\040b.txt"', patch: "saved patch", additions: 1, deletions: 0 }],
    },
  })
  const other = yield* sessions.updateMessage({
    ...base,
    id: MessageID.ascending(),
    time: { created: 3 },
    summary: { diffs: [{ patch: historicalPatch.repeat(4096), additions: 1, deletions: 0 }] },
  })
  yield* sessions.updatePart({
    id: PartID.ascending(),
    sessionID: session.id,
    messageID: other.id,
    type: "text",
    text: unrelatedPart,
  })
  return { user, other }
})

it.instance("reads the exact turn diff without materializing any message parts or another user's patch", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const summary = yield* SessionSummary.Service
    const { user } = yield* turn()
    yield* sessions.updatePart({
      id: PartID.ascending(),
      sessionID: user.sessionID,
      messageID: user.id,
      type: "text",
      text: replyOutput,
    })

    const read = yield* observeSqlitePayloads(summary.diff({ sessionID: user.sessionID, messageID: user.id }), [
      historicalPatch,
      unrelatedPart,
      replyOutput,
    ])

    expect(read.result).toEqual([{ file: "a b.txt", patch: "saved patch", additions: 1, deletions: 0 }])
    expect(read.materialized).toEqual([])
  }),
)

it.instance("summarizes interleaved replies in snapshot order without materializing unrelated history", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const summary = yield* SessionSummary.Service
    const snapshot = yield* Snapshot.Service
    const instance = yield* TestInstance
    const { user, other } = yield* turn()
    const input = { sessionID: user.sessionID, messageID: user.id }
    const assistant = (
      suffix: string,
      time: number,
      link = { sessionID: user.sessionID, parentID: user.id },
    ) => sessions.updateMessage({
      ...link,
      id: MessageID.ascending(`msg_${suffix}_${user.id}`),
      role: "assistant",
      agent: "build",
      mode: "build",
      path: { cwd: instance.directory, root: instance.directory },
      providerID: model.providerID,
      modelID: model.modelID,
      cost: 0,
      tokens,
      time: { created: time },
    })
    const later = yield* assistant("a_later", 4)
    const first = yield* assistant("m_first", 2)
    const tied = yield* assistant("z_tied", 2)
    const otherReply = yield* assistant("b_other", 5, { sessionID: user.sessionID, parentID: other.id })
    const foreign = yield* sessions.create({})
    const foreignReply = yield* assistant("foreign", 6, { sessionID: foreign.id, parentID: user.id })
    const file = `${instance.directory}/tracked.txt`
    yield* Effect.promise(() => Bun.write(file, "before\n"))
    const before = yield* snapshot.track()
    yield* Effect.promise(() => Bun.write(file, "middle\n"))
    const middle = yield* snapshot.track()
    yield* Effect.promise(() => Bun.write(file, "after\n"))
    const after = yield* snapshot.track()
    if (!before || !middle || !after) return yield* Effect.die(new Error("Expected three real snapshots"))
    const diffFull = snapshot.diffFull
    const expected = yield* diffFull(before, after)
    const partID = (suffix: string) => PartID.ascending(`prt_${suffix}_${user.id}`)
    for (const [messageID, id, hash] of [
      [first.id, "b", middle], [tied.id, "a", middle], [first.id, "a", before],
    ] as const) {
      yield* sessions.updatePart({
        id: partID(id + messageID), sessionID: user.sessionID, messageID, type: "step-start", snapshot: hash,
      })
    }
    for (const [reply, id, hash] of [
      [later, "b", after], [later, "a", middle], [otherReply, "a", before], [foreignReply, "a", middle],
    ] as const) {
      yield* sessions.updatePart({
        id: partID(id + reply.id), sessionID: reply.sessionID, messageID: reply.id, type: "step-finish", snapshot: hash,
        reason: "stop", cost: 0, tokens,
      })
    }
    yield* sessions.updatePart({ id: partID("text"), sessionID: user.sessionID, messageID: later.id, type: "text", text: replyOutput })
    const entered = yield* Deferred.make<void>()
    const resume = yield* Deferred.make<void>()
    const updated = { ...user, agent: "plan", model: { ...model, variant: "high" }, system: "updated during diff" }

    yield* Effect.acquireUseRelease(
      Effect.sync(() => spyOn(snapshot, "diffFull").mockImplementation((from, to) =>
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(resume)
          return yield* diffFull(from, to)
        }),
      )),
      () => Effect.gen(function* () {
        const pending = yield* observeSqlitePayloads(summary.summarize(input), [historicalPatch, unrelatedPart, replyOutput])
          .pipe(Effect.forkChild)
        yield* awaitWithTimeout(Deferred.await(entered), "summary never reached diffFull")
        yield* sessions.updateMessage(updated)
        yield* Deferred.succeed(resume, undefined)
        const read = yield* Fiber.join(pending)

        const message = yield* MessageV2.get(input)
        expect(message.info).toMatchObject({ ...updated, summary: { ...user.summary, diffs: expected } })
        expect(read.materialized).toEqual([])
      }),
      (spy) => Effect.sync(() => spy.mockRestore()),
    )
  }),
  { git: true },
)
