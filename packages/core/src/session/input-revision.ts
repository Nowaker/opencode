export * as SessionInputRevision from "./input-revision.js"

import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Session } from "@opencode/schema/session"
import type { Bus } from "../bus.js"
import type { Database } from "../database/database.js"
import { KVTable } from "../kv/sql.js"
import { SessionEvent } from "./event.js"

type DB = Database.Interface["db"]
const key = (sessionID: Session.ID) => `opencode/session-input-revision/${sessionID}`
const decode = Schema.decodeUnknownSync(Session.InputRevision)
const encode = Schema.encodeSync(Schema.toCodecJson(Session.InputRevision))

/** Missing means untracked legacy input, not that no input has ever been admitted. */
export const read = (db: DB, sessionID: Session.ID) =>
  db
    .select()
    .from(KVTable)
    .where(eq(KVTable.key, key(sessionID)))
    .get()
    .pipe(
      Effect.orDie,
      Effect.map((row) => (row ? decode(row.value) : null)),
    )

/** Project alongside the input mutation, even when event payload persistence is disabled. */
export const project = Effect.fn("SessionInputRevision.project")(function* (bus: Bus.Interface, db: DB) {
  for (const definition of [
    SessionEvent.Created,
    SessionEvent.Forked,
    SessionEvent.InboxEnqueued,
    SessionEvent.InboxDelivered,
    SessionEvent.InboxCancelled,
    SessionEvent.InboxDeliveryChanged,
    SessionEvent.RevertEvent.Committed,
  ]) {
    yield* bus.project(definition, (event) => {
      const value = encode({ seq: event.durable.seq, eventID: event.id })
      return db
        .insert(KVTable)
        .values({ key: key(event.data.sessionID), value })
        .onConflictDoUpdate({
          target: KVTable.key,
          set: { value },
        })
        .run()
        .pipe(Effect.orDie)
    })
  }
  yield* bus.project(SessionEvent.Deleted, (event) =>
    db
      .delete(KVTable)
      .where(eq(KVTable.key, key(event.data.sessionID)))
      .run()
      .pipe(Effect.orDie),
  )
})

export function matches(current: Session.InputRevision | null, expected: Session.InputRevision | null) {
  return current === null || expected === null
    ? current === expected
    : current.seq === expected.seq && current.eventID === expected.eventID
}
