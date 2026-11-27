import { AutoSwitchAdmission } from "@/session/auto-switch-admission"
import { LiveEvents } from "@/session/live-events"
import type { MessageID, PartID, SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseTransaction } from "@opencode-ai/core/database/transaction"
import { PartTable } from "@opencode-ai/core/session/sql"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { HttpApiError } from "effect/unstable/httpapi"
import * as SessionError from "./session-errors"

type PartPath = { readonly sessionID: SessionID; readonly messageID: MessageID; readonly partID: PartID }

export const makePartHandlers = Effect.gen(function* () {
  const session = yield* Session.Service
  const { db } = yield* Database.Service
  const live = yield* LiveEvents.Service

  const edit = <A>(params: PartPath, write: (part: SessionV1.Part | undefined) => Effect.Effect<A, HttpApiError.BadRequest>) =>
    live.guard(params.sessionID, DatabaseTransaction.batch(db, Effect.gen(function* () {
      yield* SessionError.mapStorageNotFound(session.get(params.sessionID))
      // The projector upserts on the globally unique part id, not the enclosing route ids.
      const row = yield* db.select({ sessionID: PartTable.session_id, messageID: PartTable.message_id })
        .from(PartTable).where(eq(PartTable.id, params.partID)).get().pipe(Effect.orDie)
      if (row && (row.sessionID !== params.sessionID || row.messageID !== params.messageID)) {
        return yield* new HttpApiError.BadRequest({})
      }
      const part = row ? yield* session.getPart(params) : undefined
      if (AutoSwitchAdmission.ownsPart(part)) return yield* new HttpApiError.BadRequest({})
      return yield* write(part)
    })).pipe(Effect.catchTag("SqlError", Effect.die)))

  const deletePart = Effect.fn("SessionHttpApi.deletePart")(function* (ctx: { readonly params: PartPath }) {
    return yield* edit(ctx.params, (part) => {
      if (part?.type === "compaction" && part.continuation_message_id !== undefined) {
        return Effect.fail(new HttpApiError.BadRequest({}))
      }
      return session.removePart(ctx.params).pipe(Effect.as(true))
    })
  })

  const updatePart = Effect.fn("SessionHttpApi.updatePart")(function* (ctx: {
    readonly params: PartPath
    readonly payload: typeof SessionV1.Part.Type
  }) {
    const { params, payload } = ctx
    return yield* edit<typeof SessionV1.Part.Type>(params, (part) => {
      if (payload.id !== params.partID || payload.messageID !== params.messageID ||
          payload.sessionID !== params.sessionID || AutoSwitchAdmission.ownsPart(payload)) {
        return Effect.fail(new HttpApiError.BadRequest({}))
      }
      const owner = part?.type === "compaction" ? part.continuation_message_id : undefined
      if (payload.type === "compaction") {
        const { continuation_message_id, ...editable } = payload
        return session.updatePart({ ...editable, ...(owner !== undefined && { continuation_message_id: owner }) })
      }
      if (owner !== undefined) return Effect.fail(new HttpApiError.BadRequest({}))
      return session.updatePart(payload)
    })
  })

  return { deletePart, updatePart }
})
