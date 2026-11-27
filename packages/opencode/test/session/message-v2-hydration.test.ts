import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { MessageTable, PartTable } from "@opencode-ai/core/session/sql"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Effect } from "effect"
import { eq, sql } from "drizzle-orm"
import { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session/session"
import { MessageID, PartID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Session.node, MessageV2.node, SessionProjector.node])))
const model = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") }
const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

for (const role of ["user", "assistant"] as const) {
  it.instance(`hydrates ${role} rows with stable keys despite optional fields and JSON key order`, () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const session = yield* sessions.create({})
      const data: SessionV1.Info =
        role === "user"
          ? { id: MessageID.ascending(), sessionID: session.id, role, time: { created: 1 }, agent: "build", model }
          : {
              id: MessageID.ascending(),
              sessionID: session.id,
              role,
              time: { created: 1 },
              agent: "build",
              parentID: MessageID.ascending(),
              modelID: model.modelID,
              providerID: model.providerID,
              mode: "build",
              path: { cwd: "/fixture", root: "/fixture" },
              cost: 0,
              tokens,
            }
      const optional =
        role === "user"
          ? { system: "system", tools: { bash: true }, summary: { diffs: [] } }
          : { finish: "stop", variant: "high", summary: false }
      const rows = [data, { ...optional, ...data, id: MessageID.ascending() }]
      yield* database.db
        .insert(MessageTable)
        .values(
          rows.map((row) => ({
            id: row.id,
            session_id: session.id,
            time_created: 1,
            time_updated: 1,
            data: row,
          })),
        )
        .run()
        .pipe(Effect.orDie)

      const projected = (yield* MessageV2.page({ sessionID: session.id, limit: 2 })).items
      const exact = yield* Effect.all(rows.map((row) => MessageV2.get({ sessionID: session.id, messageID: row.id })))

      for (const hydrated of [projected, exact]) {
        expect(Object.keys(hydrated[0]?.info ?? {})).toEqual(Object.keys(hydrated[1]?.info ?? {}))
        expect(hydrated[0]?.info.summary).toBeUndefined()
        expect(hydrated[1]?.info).toMatchObject({ ...optional, ...data, id: rows[1]?.id })
      }
    }),
  )
}

it.instance("hydrates each part discriminator with stable keys across stored JSON layouts", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const database = yield* Database.Service
    const session = yield* sessions.create({})
    const message = yield* sessions.updateMessage({
      id: MessageID.ascending(),
      sessionID: session.id,
      role: "user",
      time: { created: 1 },
      agent: "build",
      model,
    })
    const base = { id: PartID.ascending(), sessionID: session.id, messageID: message.id }
    const fixtures: SessionV1.Part[] = [
      { ...base, type: "text", text: "answer" },
      { ...base, type: "reasoning", text: "thought", time: { start: 1 } },
      { ...base, type: "tool", callID: "call", tool: "bash", state: { status: "pending", input: {}, raw: "" } },
      { ...base, type: "file", mime: "text/plain", url: "file:///fixture" },
      { ...base, type: "compaction", auto: true },
      { ...base, type: "subtask", prompt: "task", description: "task", agent: "build" },
      { ...base, type: "step-start" },
      { ...base, type: "step-finish", reason: "stop", cost: 0, tokens },
      { ...base, type: "snapshot", snapshot: "snapshot" },
      { ...base, type: "patch", hash: "hash", files: ["file"] },
      { ...base, type: "agent", name: "build" },
      {
        ...base,
        type: "retry",
        attempt: 1,
        error: { name: "APIError", data: { message: "retry", isRetryable: true } },
        time: { created: 1 },
      },
    ]
    for (const fixture of fixtures) {
      const ids = [PartID.ascending(), PartID.ascending()]
      const reordered = Object.fromEntries(Object.entries(fixture).reverse())
      const rows = [fixture, Object.assign(reordered, fixture, { metadata: { fixture: true }, filename: "file.txt" })]
      yield* database.db
        .insert(PartTable)
        .values(
          ids.map((id, index) => ({
            id,
            session_id: session.id,
            message_id: message.id,
            time_created: 1,
            time_updated: 1,
            data: rows[index] ?? fixture,
          })),
        )
        .run()
        .pipe(Effect.orDie)

      const hydrated = (yield* MessageV2.parts(message.id)).filter((part) => ids.includes(part.id))

      expect(hydrated).toHaveLength(2)
      expect(Object.keys(hydrated[0] ?? {})).toEqual(Object.keys(hydrated[1] ?? {}))
      expect(hydrated[0]).toMatchObject({ ...fixture, id: ids[0] })
    }
  }),
)

const cachedRows = Effect.fn("test.cachedRows")(function* () {
  const sessions = yield* Session.Service
  const database = yield* Database.Service
  const session = yield* sessions.create({})
  const message = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    sessionID: session.id,
    role: "user",
    time: { created: 1 },
    agent: "build",
    model,
  })
  const part = yield* sessions.updatePart({
    id: PartID.ascending(),
    sessionID: session.id,
    messageID: message.id,
    type: "text",
    text: "before",
  })
  yield* database.db
    .update(MessageTable)
    .set({ time_updated: 1 })
    .where(eq(MessageTable.id, message.id))
    .run()
    .pipe(Effect.orDie)
  yield* database.db
    .update(PartTable)
    .set({ time_updated: 1 })
    .where(eq(PartTable.id, part.id))
    .run()
    .pipe(Effect.orDie)
  const input = { sessionID: session.id, messageID: message.id }
  return { database, message, part, input, first: yield* MessageV2.get(input) }
})

for (const kind of ["info", "part"] as const) {
  it.instance(`reuses unchanged hydrated ${kind} rows without sharing the parts array`, () =>
    Effect.gen(function* () {
      const fixture = yield* cachedRows()

      const same = yield* MessageV2.get(fixture.input)

      expect(kind === "info" ? same.info : same.parts[0]).toBe(
        kind === "info" ? fixture.first.info : fixture.first.parts[0],
      )
      expect(same.parts).not.toBe(fixture.first.parts)
    }),
  )
}

it.instance("refreshes hydrated info and parts when row timestamps change", () =>
  Effect.gen(function* () {
    const fixture = yield* cachedRows()
    const database = fixture.database
    const message = fixture.message
    const part = fixture.part
    const changedMessage: SessionV1.User = { ...message, system: "changed" }
    const changedPart: SessionV1.TextPart = { ...part, text: "after" }
    yield* database.db
      .update(MessageTable)
      .set({ time_updated: 2, data: changedMessage })
      .where(eq(MessageTable.id, message.id))
      .run()
      .pipe(Effect.orDie)
    yield* database.db
      .update(PartTable)
      .set({ time_updated: 2, data: changedPart })
      .where(eq(PartTable.id, part.id))
      .run()
      .pipe(Effect.orDie)

    const changed = yield* MessageV2.get(fixture.input)

    expect(changed.info).not.toBe(fixture.first.info)
    expect(changed.parts[0]).not.toBe(fixture.first.parts[0])
    expect(changed.info).toMatchObject({ system: "changed" })
    expect(changed.parts[0]).toMatchObject({ text: "after" })
  }),
)

const historyWithDiff = Effect.fnUntraced(function* () {
  const sessions = yield* Session.Service
  const database = yield* Database.Service
  const session = yield* sessions.create({})
  const modified = { file: 'src/"one".ts', status: "modified" as const, additions: 3, deletions: 2 }
  const deleted = { file: "two.ts", status: "deleted" as const, additions: 0, deletions: 1 }
  const title = { title: "Changes", body: "Two files" }
  const full = {
    ...title,
    diffs: [{ ...modified, patch: "@@ -1 +1 @@\n-old\n+new", before: "old", after: "new" }, deleted],
  }
  const message = {
    id: MessageID.ascending(),
    sessionID: session.id,
    role: "user",
    agent: "build",
    model,
    time: { created: 1 },
    system: "fixture instructions",
    promptOrigin: { client: "oh-my-openagent", version: "1.2.3", purpose: "subagent" },
    summary: full,
  } satisfies SessionV1.User
  yield* database.db
    .insert(MessageTable)
    .values({ id: message.id, session_id: session.id, time_created: 1, time_updated: 1, data: message })
    .run()
    .pipe(Effect.orDie)
  return { message, database, metadata: { ...title, diffs: [modified, deleted] } }
})

for (const firstRead of ["metadata", "exact"] as const) {
  it.instance(`keeps full and projected diff reads separate when ${firstRead} is read first`, () =>
    Effect.gen(function* () {
      const fixture = yield* historyWithDiff()
      const message = fixture.message
      const input = { sessionID: message.sessionID, limit: 1 }
      const metadata = MessageV2.page(input)
      const exactPage = MessageV2.page({ ...input, includeDiffBodies: true })
      const exactGet = MessageV2.get({ sessionID: message.sessionID, messageID: message.id })

      const initial = firstRead === "exact" ? (yield* exactGet).info : (yield* metadata).items[0]?.info
      const exact = (yield* exactPage).items[0]?.info
      const exactAgain = (yield* exactGet).info
      const thin = (yield* metadata).items[0]?.info

      expect(initial?.role === "user" && initial.summary).toEqual(
        firstRead === "exact" ? message.summary : fixture.metadata,
      )
      expect(exact?.role === "user" && exact.summary).toEqual(message.summary)
      expect(exactAgain.role === "user" && exactAgain.summary).toEqual(message.summary)
      expect(exactAgain).not.toBe(exact)
      expect(thin?.role === "user" && thin.summary).toEqual(fixture.metadata)
      expect(thin).toMatchObject({ id: message.id, system: message.system, model })
      for (const info of [exact, exactAgain, thin]) {
        expect(info?.role === "user" && MessageV2.storedPromptOrigin(info)).toEqual(message.promptOrigin)
      }
    }),
  )
}

for (const read of [MessageV2.stream, MessageV2.filterCompactedEffect]) {
  it.instance(`projects stored diff bodies in ${read === MessageV2.stream ? "stream" : "compacted history"}`, () =>
    Effect.gen(function* () {
      const fixture = yield* historyWithDiff()

      const [message] = yield* read(fixture.message.sessionID)

      expect(message?.info.role === "user" && message.info.summary).toEqual(fixture.metadata)
    }),
  )
}

it.instance("projects only object entries in a legacy diff array without coercing other values", () =>
  Effect.gen(function* () {
    const fixture = yield* historyWithDiff()
    const legacyEntries = [null, true, false, '["text"]', 12, ["nested"]]
    const data = {
      ...fixture.message,
      summary: { diffs: [...legacyEntries, { file: "old.ts", before: "before", after: "after", legacy: "hint" }] },
    }
    yield* fixture.database.db
      .update(MessageTable)
      .set({ data: sql`${JSON.stringify(data)}` })
      .where(eq(MessageTable.id, data.id))
      .run()
      .pipe(Effect.orDie)

    const page = yield* MessageV2.page({ sessionID: data.sessionID, limit: 1 })
    const info = page.items[0]?.info

    expect<unknown>(info?.role === "user" && info.summary).toEqual({
      diffs: [...legacyEntries, { file: "old.ts", legacy: "hint" }],
    })
  }),
)
