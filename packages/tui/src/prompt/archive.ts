import { Option, Schema } from "effect"
import { SessionArchive } from "@opencode-ai/schema/session-archive"
import type { Session } from "@opencode-ai/sdk/v2"

const metadata = Schema.decodeUnknownOption(
  Schema.Struct({
    vibeterm: Schema.Struct({ archive: SessionArchive.Info }),
  }),
)
const refusal = Schema.decodeUnknownOption(
  Schema.Struct({
    name: Schema.Literal("SessionArchivedError"),
    data: SessionArchive.Details,
  }),
)

export function archiveDetails(session: Session | undefined): SessionArchive.Details | undefined {
  if (session?.time.archived === undefined) return
  const archived = archiveRecord(session)?.archived
  return {
    sessionID: session.id,
    archivedAt: session.time.archived,
    ...(archived?.note !== undefined ? { note: archived.note } : {}),
    ...(archived?.by ? { by: archived.by } : {}),
  }
}

export function archiveRecord(session: Session | undefined): SessionArchive.Info | undefined {
  if (!session) return
  const record = Option.getOrUndefined(metadata(session.metadata))?.vibeterm.archive
  return record?.sessionId === session.id ? record : undefined
}

export function archiveError(error: unknown): SessionArchive.Details | undefined {
  return Option.getOrUndefined(refusal(error))?.data
}
