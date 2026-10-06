import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { MessageTable, PartTable } from "@opencode-ai/core/session/sql"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
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
        role === "user" ? { system: "system", tools: { bash: true } } : { finish: "stop", variant: "high" }
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

      const hydrated = yield* Effect.all(rows.map((row) => MessageV2.get({ sessionID: session.id, messageID: row.id })))

      expect(Object.keys(hydrated[0]?.info ?? {})).toEqual(Object.keys(hydrated[1]?.info ?? {}))
      expect(hydrated[1]?.info).toMatchObject({ ...optional, ...data, id: rows[1]?.id })
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
