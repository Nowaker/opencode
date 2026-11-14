export * as SessionRecovery from "./recovery.js"

import { and, desc, eq } from "drizzle-orm"
import { Effect } from "effect"
import { isSqlError } from "effect/sql/SqlError"
import { Event } from "@opencode/schema/event"
import { Session } from "@opencode/schema/session"
import type { Database } from "../database/database.js"
import { NotFoundError } from "./error.js"
import { SessionInputRevision } from "./input-revision.js"
import { SessionInboxTable, SessionMessageTable, SessionTable } from "./sql.js"

type DB = Database.Interface["db"]

export const read = Effect.fn("SessionRecovery.read")(function* (db: DB, sessionID: Session.ID) {
  const session = yield* db
    .select({ claim: SessionTable.time_suspended, revert: SessionTable.revert })
    .from(SessionTable)
    .where(eq(SessionTable.id, sessionID))
    .get()
    .pipe(Effect.orDie)
  if (!session) return yield* new NotFoundError({ sessionID })
  const latest = (type?: "assistant" | "idle") =>
    db
      .select({ id: SessionMessageTable.id, seq: SessionMessageTable.seq })
      .from(SessionMessageTable)
      .where(and(eq(SessionMessageTable.session_id, sessionID), type ? eq(SessionMessageTable.type, type) : undefined))
      .orderBy(desc(SessionMessageTable.seq))
      .limit(1)
      .get()
      .pipe(Effect.orDie)
  const head = yield* latest()
  const assistant = yield* latest("assistant")
  const idle = yield* latest("idle")
  const inputRevision = yield* SessionInputRevision.read(db, sessionID)
  const pending = yield* db
    .select({ id: SessionInboxTable.id })
    .from(SessionInboxTable)
    .where(eq(SessionInboxTable.session_id, sessionID))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return {
    assistantMessageID: assistant?.id ?? null,
    idleMessageID: idle?.id ?? null,
    throughSeq: head?.seq ?? -1,
    executionClaim: session.claim,
    inputRevision,
    pendingInput: pending !== undefined,
    stagedRevert: session.revert !== null,
  }
})

export const snapshot = (db: DB, sessionID: Session.ID, identity: () => Event.ID | null) =>
  db
    .transaction(
      () =>
        Effect.gen(function* () {
          const { stagedRevert, ...durable } = yield* read(db, sessionID)
          return yield* Effect.sync((): Session.Recovery => {
            const executionID = identity()
            return { ...durable, executionID, localActive: executionID !== null }
          })
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.catchIf(isSqlError, Effect.die))

export const checkPrompt = Effect.fn("SessionRecovery.checkPrompt")(function* (input: {
  readonly db: DB
  readonly sessionID: Session.ID
  readonly expected: Session.PromptExpected
  readonly identity: () => Event.ID | null
}) {
  const current = yield* read(input.db, input.sessionID)
  const reason =
    current.executionClaim !== null || current.pendingInput
      ? "not-idle"
      : !SessionInputRevision.matches(current.inputRevision, input.expected.inputRevision)
        ? "input-changed"
        : current.stagedRevert ||
            current.idleMessageID !== input.expected.idleMessageID ||
            current.throughSeq !== input.expected.throughSeq
          ? "idle-changed"
          : undefined
  if (reason) return yield* new Session.PromptGuardError({ accepted: false, sessionID: input.sessionID, reason })
  if (yield* Effect.sync(() => input.identity() !== null))
    return yield* new Session.PromptGuardError({ accepted: false, sessionID: input.sessionID, reason: "not-idle" })
})
