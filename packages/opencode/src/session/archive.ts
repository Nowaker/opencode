import { Context, Effect, Option, Schema } from "effect"
import { Details, Info } from "@opencode-ai/schema/session-archive"
import { Session } from "./session"
import { SessionID } from "./schema"
import { isRecord } from "@/util/record"

export class Error extends Schema.TaggedErrorClass<Error>()("SessionArchivedError", { data: Details }) {}

export const Client = Context.Reference<"tui" | "api">("~opencode/SessionArchive/Client", { defaultValue: () => "api" })

export const admit = Effect.fn("SessionArchive.admit")(function* (
  sessions: Session.Interface,
  input: { sessionID: SessionID; noReply?: boolean; unarchive?: boolean },
) {
  // Session.get reads the row each time: external SQLite writers publish no session.updated event.
  const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
  if (session.time.archived === undefined) return session
  const metadata = session.metadata ?? {}
  const vibeterm = isRecord(metadata.vibeterm) ? metadata.vibeterm : {}
  const archive = isRecord(vibeterm.archive) ? vibeterm.archive : {}
  const info = Option.getOrUndefined(Schema.decodeUnknownOption(Info)(archive))
  const archived = info?.sessionId === session.id ? info.archived : undefined
  if (input.unarchive !== true) {
    if (input.noReply === true) return session
    return yield* new Error({
      data: {
        sessionID: input.sessionID,
        archivedAt: session.time.archived,
        ...(archived?.note !== undefined ? { note: archived.note } : {}),
        ...(archived?.by ? { by: archived.by } : {}),
      },
    })
  }
  const { announcedAt, ...rest } = archive
  yield* sessions.setMetadata({
    sessionID: input.sessionID,
    metadata: {
      ...metadata,
      vibeterm: {
        ...vibeterm,
        archive: {
          ...rest,
          sessionId: input.sessionID,
          unarchived: {
            at: Date.now(),
            by: {
              kind: "user",
              machine: process.env.VIBETERM_MACHINE_NAME ?? null,
              client: yield* Client,
            },
          },
        },
      },
    },
  })
  yield* sessions.setArchived({ sessionID: input.sessionID })
  return yield* sessions.get(input.sessionID).pipe(Effect.orDie)
})

export * as SessionArchive from "./archive"
