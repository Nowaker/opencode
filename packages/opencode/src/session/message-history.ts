import { randomUUID } from "node:crypto"
import { Cause, Effect } from "effect"
import { and, eq, sql } from "drizzle-orm"
import type { Database } from "@opencode-ai/core/database/database"
import { SessionMaintenance } from "@opencode-ai/core/database/session-maintenance"
import { DatabaseTransaction } from "@opencode-ai/core/database/transaction"
import { MessageTable, SessionInputTable, SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import type { EventV2 } from "@opencode-ai/core/event"
import type {
  MessageHistoryBoundary,
  MessageHistoryClassifier,
  MessageHistoryReady,
  MessageHistoryRequest,
  MessageHistoryResult,
  MessageHistoryUnavailable,
  MessageHistoryUnavailableReason,
} from "@opencode-ai/plugin"
import { InstanceState } from "@/effect/instance-state"
import { OwnerQuiescence } from "@/owner/quiescence"
import { InstanceActivity } from "@/project/instance-activity"
import { isRecord } from "@/util/record"
import type { LiveEvents } from "./live-events"
import { MessageHistoryQuery } from "./message-history-query"
import { MessageHistoryState } from "./message-history-state"
import { SessionID } from "./schema"
import { Session } from "./session"
import type { SessionStatus } from "./status"

type DB = Database.Interface["db"]
type Answer = MessageHistoryReady | MessageHistoryUnavailable | MessageHistoryResult
type Refusal = Extract<MessageHistoryResult, { status: "rejected" }>["reason"]

const empty = { boundaryKind: "unknown", boundaryMessageID: null, boundaryCreatedAt: null } as const
const clear = { ...empty, boundaryKind: "none" } as const
const rejected = (reason: Refusal): MessageHistoryResult => ({ version: 1, status: "rejected", reason })

function unavailable(
  request: MessageHistoryRequest,
  reason: MessageHistoryUnavailableReason,
  boundary: MessageHistoryBoundary = empty,
): Answer {
  if (request.operation === "mutate") return rejected(reason)
  return { version: 1, status: "unavailable", reason, ...boundary }
}

function coordinates(boundary: MessageHistoryQuery.Coordinate) {
  return { boundaryKind: "protected", boundaryMessageID: boundary.id, boundaryCreatedAt: boundary.created } as const
}

export function make(input: {
  readonly db: DB
  readonly live: LiveEvents.Interface
  readonly events: EventV2.Interface
  readonly status: SessionStatus.Interface
  readonly signal: AbortSignal
}) {
  const issued = new Map<string, { readonly state: string; readonly revision: string; readonly expires: number }>()
  const ownerNonce = randomUUID()
  let mutationEpoch = 0
  input.signal.addEventListener("abort", () => issued.clear(), { once: true })

  function revision(sessionID: string, state: string) {
    const now = performance.now()
    const prior = issued.get(sessionID)
    if (prior?.state === state && prior.expires > now) return prior.revision
    issued.delete(sessionID)
    if (issued.size >= 256) {
      const oldest = issued.keys().next()
      if (!oldest.done) issued.delete(oldest.value)
    }
    const next = randomUUID()
    issued.set(sessionID, { state, revision: next, expires: now + 5 * 60_000 })
    return next
  }

  const execute = Effect.fn("MessageHistory.execute")(function* (
    request: MessageHistoryRequest,
    isHumanTurn: MessageHistoryClassifier,
  ) {
    if (request.version !== 1) return unavailable(request, "unsupported-owner")
    const owner = yield* InstanceState.context
    const workspaceID = yield* InstanceState.workspaceID
    const sessionID = SessionID.make(request.sessionID)
    const db = input.db
    const epoch = mutationEpoch
    const retired = () => input.signal.aborted || InstanceActivity.get(owner)?.retired === true
    const readBlock = () => {
      if (retired()) return "owner-unavailable" as const
      const status = OwnerQuiescence.status()
      if (status.sealed) return "owner-unavailable" as const
      if (status.active || mutationEpoch !== epoch) return "busy" as const
    }
    const inspect = (blocked?: "busy" | "owner-unavailable") =>
      Effect.gen(function* () {
        const invalidate = () => {
          if (!blocked && (request.operation === "mutate" || mutationEpoch === epoch)) issued.delete(sessionID)
        }
        yield* SessionMaintenance.assertCurrent(db, sessionID)
        const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get()
        if (!row) {
          invalidate()
          return request.operation === "mutate" ? rejected("session-not-found") : unavailable(request, "unsupported-owner")
        }
        if (row.parent_id !== null || row.directory !== owner.directory || row.project_id !== owner.project.id ||
          (row.workspace_id ?? undefined) !== workspaceID) {
          invalidate()
          return unavailable(request, "unsupported-owner")
        }
        const v2 = yield* db.get(sql`select 1 where
          exists (select 1 from ${SessionMessageTable} where ${SessionMessageTable.session_id} = ${sessionID}) or
          exists (select 1 from ${SessionInputTable} where ${SessionInputTable.session_id} = ${sessionID})`)
        if (v2) {
          invalidate()
          return unavailable(request, "unsupported-owner")
        }

        const stored = MessageHistoryState.read({ id: row.id, metadata: row.metadata ?? undefined })
        const protectedBoundary = stored && stored !== "unknown" && stored.boundaryMessageID !== null
          ? coordinates({ id: stored.boundaryMessageID, created: stored.boundaryCreatedAt }) : undefined
        const revert = row.revert
        if (revert !== null) {
          invalidate()
          const armed = isRecord(revert) && (Object.hasOwn(revert, "snapshot") || Object.hasOwn(revert, "diff"))
          const reason = armed ? "armed-revert" : "unsupported-boundary"
          if (protectedBoundary || stored === "unknown") return unavailable(request, reason, protectedBoundary ?? empty)
          const id = isRecord(revert) && typeof revert.messageID === "string" && revert.messageID ? revert.messageID : null
          const message = id === null ? undefined : yield* db.select({ created: MessageTable.time_created })
            .from(MessageTable).where(and(eq(MessageTable.session_id, sessionID), sql`${MessageTable.id} = ${id}`)).get()
          return unavailable(request, reason, {
            boundaryKind: armed ? "armed" : "legacy",
            boundaryMessageID: id,
            boundaryCreatedAt: message?.created ?? null,
          })
        }

        if (stored === "unknown" || stored?.conflict) {
          invalidate()
          return unavailable(request, "unsupported-boundary", protectedBoundary ?? empty)
        }
        const boundary = protectedBoundary ?? clear
        if (retired()) return unavailable(request, "owner-unavailable", boundary)
        const status = yield* input.status.get(sessionID)
        if (row.metadata?.pause != null || status.paused || (yield* MessageHistoryQuery.deferred(db, sessionID)))
          return unavailable(request, "paused", boundary)
        const unavailableReason = blocked ?? (request.operation === "read" ? readBlock() : undefined)
        if (unavailableReason || status.type !== "idle") return unavailable(request, unavailableReason ?? "busy", boundary)
        if (input.signal.aborted) return unavailable(request, "owner-unavailable", boundary)

        const history = yield* MessageHistoryQuery.classify(db, { sessionID, isHumanTurn })
        if (!history) {
          invalidate()
          return unavailable(request, "unsupported-boundary", boundary)
        }
        const { humans, fingerprint } = history
        const cut = boundary.boundaryKind === "none" ? humans.length : humans.findIndex((message) =>
          message.id === boundary.boundaryMessageID && message.created === boundary.boundaryCreatedAt)
        if (cut < 0 || (boundary.boundaryKind === "protected" && stored?.historyFingerprint !== fingerprint)) {
          invalidate()
          return unavailable(request, "unsupported-boundary", boundary)
        }

        const ready = (at: number, updated: number, marker: MessageHistoryState.Stored | undefined): MessageHistoryReady => {
          const state = JSON.stringify([ownerNonce, row.id, row.time_created, updated, marker?.revision, marker?.generation, at, fingerprint])
          const result = { version: 1, status: "ready", canUndo: at > 0, revision: revision(sessionID, state) } as const
          const hidden = humans[at]
          return hidden ? { ...result, ...coordinates(hidden), canRedo: true } : { ...result, ...clear, canRedo: false }
        }

        if (request.operation === "read") {
          const unavailableReason = readBlock()
          return unavailableReason ? unavailable(request, unavailableReason, boundary) : ready(cut, row.time_updated, stored)
        }
        const current = ready(cut, row.time_updated, stored)
        if (request.mutation.expectedRevision !== current.revision) return rejected("stale-revision")
        const undo = request.mutation.action === "undo"
        const affected = humans[undo ? cut - 1 : cut]
        if (!affected) return rejected(undo ? "nothing-to-undo" : "nothing-to-redo")
        const nextRevision = (stored?.revision ?? 0) + 1
        if (!Number.isSafeInteger(nextRevision)) return rejected("unsupported-boundary")
        const nextCut = undo ? cut - 1 : cut + 1
        const hidden = humans[nextCut]
        const messageHistory: MessageHistoryState.Stored = {
          version: 1,
          sessionID,
          revision: nextRevision,
          generation: randomUUID(),
          ...(hidden
            ? { boundaryMessageID: hidden.id, boundaryCreatedAt: hidden.created, historyFingerprint: fingerprint }
            : { boundaryMessageID: null, boundaryCreatedAt: null, historyFingerprint: null }),
        }
        const info = Session.fromRow(row)
        const updated = Math.max(Date.now(), info.time.updated + 1)
        yield* input.events.publish(Session.Event.Updated, {
          sessionID,
          info: { ...info, metadata: { ...row.metadata, messageHistory }, time: { ...info.time, updated } },
        })
        return {
          version: 1, status: "applied", state: ready(nextCut, updated, messageHistory), affectedUserMessageID: affected.id,
        } satisfies MessageHistoryResult
      })

    if (request.operation === "read")
      return yield* db.transaction(() => inspect(readBlock())).pipe(
        Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.succeed(unavailable(request, "owner-unavailable")) }),
      )

    const work = Effect.acquireUseRelease(
      Effect.sync(() => {
        if (retired()) return { status: "retired" } as const
        const reservation = OwnerQuiescence.tryExclusive()
        if (reservation.status === "acquired") mutationEpoch++
        return reservation
      }),
      (reservation) => Effect.gen(function* () {
        if (reservation.status !== "acquired")
          return yield* db.transaction(() => inspect(reservation.status === "busy" ? "busy" : "owner-unavailable"))
        return yield* DatabaseTransaction.batch(db, inspect()).pipe(
          Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.succeed(rejected("outcome-unknown")) }),
        )
      }),
      (reservation) => Effect.sync(() => {
        if (reservation.status === "acquired") reservation.lease[Symbol.dispose]()
      }),
    )
    return yield* input.live.guard(sessionID, work)
  }, (work, request) => work.pipe(Effect.catchCauseIf(
    (cause) => !Cause.hasInterrupts(cause),
    () => Effect.logWarning("Message history operation failed", { sessionID: request.sessionID, operation: request.operation }).pipe(
      Effect.as(request.operation === "mutate" ? rejected("outcome-unknown") : unavailable(request, "owner-unavailable")),
    ),
  )))

  return execute
}

export * as MessageHistory from "./message-history"
