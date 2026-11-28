import { expect, test } from "bun:test"
import { z } from "zod"
import { MessageID, PartID } from "../../src/session/schema"
import { model, withHistoryServer } from "./message-history-fixture"

test("v1 history refuses IDs Portal cannot use as a boundary without issuing a revision", async () => {
  await withHistoryServer(async ({ db, createSession, history }) => {
    const insertMessage = db.query(
      "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
    )
    const insertPart = db.query(
      "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
    )
    const readSession = db.query("SELECT * FROM session WHERE id = ?")
    const readMessages = db.query("SELECT * FROM message WHERE session_id = ? ORDER BY id")
    const readParts = db.query("SELECT * FROM part WHERE session_id = ? ORDER BY id")
    const validAtLimit = `msg_${"V".repeat(252)}`
    const cases = [
      { label: "newest genuine turn", validID: MessageID.ascending(), id: "msg_newest-invalid", time: 300, synthetic: false },
      { label: "non-human predecessor", validID: MessageID.ascending(), id: "msg_legacy_predecessor", time: 100, synthetic: true },
      { label: "257-character alphanumeric ID", validID: validAtLimit, id: `msg_${"V".repeat(253)}`, time: 300, synthetic: false },
    ] as const
    const outcomes = []
    for (const sample of cases) {
      const sessionID = await createSession()
      const seed = db.transaction((id: string, time: number, synthetic = false) => {
        const data = JSON.stringify({ role: "user", agent: "build", model, time: { created: time } })
        insertMessage.run(id, sessionID, time, time, data)
        const part = JSON.stringify({ type: "text", text: "Human: fixture turn", synthetic })
        insertPart.run(PartID.ascending(), id, sessionID, time, time, part)
      })
      seed(sample.validID, 200)
      const initial = await history(sessionID, { operation: "read" })
      const issued = z.object({
        version: z.literal(1), status: z.literal("ready"), boundaryKind: z.literal("none"),
        canUndo: z.literal(true), revision: z.string().min(1),
      }).parse(initial)

      seed(sample.id, sample.time, sample.synthetic)
      const stored = () => ({
        session: readSession.get(sessionID), messages: readMessages.all(sessionID), parts: readParts.all(sessionID),
      })
      const before = stored()
      const mutation = await history(sessionID, {
        operation: "mutate", mutation: { action: "undo", expectedRevision: issued.revision },
      })
      const read = await history(sessionID, { operation: "read" })
      expect(stored(), sample.label).toEqual(before)
      outcomes.push({ label: sample.label, read, mutation })
    }
    expect(outcomes).toEqual(cases.map(({ label }) => ({
      label,
      read: {
        version: 1, status: "unavailable", reason: "unsupported-boundary",
        boundaryKind: "none", boundaryMessageID: null, boundaryCreatedAt: null,
      },
      mutation: { version: 1, status: "rejected", reason: "unsupported-boundary" },
    })))
  })
}, 60_000)
