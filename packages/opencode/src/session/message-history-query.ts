import { createHash } from "node:crypto"
import { Effect } from "effect"
import { and, eq, sql } from "drizzle-orm"
import type { Database } from "@opencode-ai/core/database/database"
import { MessageTable, PartTable } from "@opencode-ai/core/session/sql"
import type { MessageHistoryClassifier } from "@opencode-ai/plugin"
import type { SessionID } from "./schema"

type DB = Database.Interface["db"]
export type Coordinate = { readonly id: string; readonly created: number }

export function deferred(db: DB, sessionID: SessionID) {
  return db.select({ id: PartTable.id }).from(PartTable).where(and(eq(PartTable.session_id, sessionID), sql`
    json_extract(${PartTable.data}, '$.type') = 'tool' and
    json_extract(${PartTable.data}, '$.state.status') = 'pending' and
    json_extract(${PartTable.data}, '$.state.metadata.deferred') is not null`)).get()
}

export function classify(db: DB, input: { readonly sessionID: SessionID; readonly isHumanTurn: MessageHistoryClassifier }) {
  return Effect.gen(function* () {
    const rows = yield* db.select({ id: MessageTable.id, created: MessageTable.time_created, data: sql`
      case when json_extract(${MessageTable.data}, '$.role') = 'user' then ${MessageTable.data}
      else json_object('role', json_extract(${MessageTable.data}, '$.role')) end`.mapWith(MessageTable.data) })
      .from(MessageTable).where(eq(MessageTable.session_id, input.sessionID))
      .orderBy(MessageTable.time_created, sql`${MessageTable.id} collate binary`).all()
    const parts = yield* db.select({ id: PartTable.id, messageID: PartTable.message_id, data: sql`
      case when json_extract(${PartTable.data}, '$.type') = 'file' then json_object('type', 'file')
      else ${PartTable.data} end`.mapWith(PartTable.data) })
      .from(PartTable).innerJoin(MessageTable, eq(MessageTable.id, PartTable.message_id))
      .where(and(eq(PartTable.session_id, input.sessionID), eq(MessageTable.session_id, input.sessionID),
        sql`json_extract(${MessageTable.data}, '$.role') = 'user'`))
      .orderBy(sql`${PartTable.id} collate binary`).all()
    const byMessage = Map.groupBy(parts, (part) => part.messageID)
    const firstUser = rows.find((row) => row.data.role === "user")?.id
    const hash = createHash("sha256")
    const humans: Coordinate[] = []
    for (const row of rows) {
      const role = row.data.role
      if (role !== "user" && role !== "assistant") return undefined
      if (!Number.isSafeInteger(row.created) || row.created < 0) return undefined
      const storedParts = byMessage.get(row.id) ?? []
      // Legacy noReply users are indistinguishable from unanswered users; an absent assistant is not a queue marker.
      const human = role === "user" && input.isHumanTurn(
        { ...row.data, id: row.id, sessionID: input.sessionID },
        storedParts.map((part) => part.data.type === "file" ? { type: "file" }
          : { ...part.data, id: part.id, messageID: part.messageID, sessionID: input.sessionID }),
        row.id === firstUser,
      ) === true
      hash.update(JSON.stringify([row.id, row.created, role, human, storedParts.map((part) => [part.id, part.data.type])]))
      if (human) humans.push(row)
    }
    return { humans, fingerprint: hash.digest("hex") }
  })
}

export * as MessageHistoryQuery from "./message-history-query"
