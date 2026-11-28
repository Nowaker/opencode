import { NonNegativeInt } from "@opencode-ai/core/schema"
import { isRecord } from "@/util/record"
import { Option, Schema } from "effect"
import { SessionID } from "./schema"
import type { Session } from "./session"

export const Preference = Schema.Literals(["inherit", "on", "off"])
export type Preference = typeof Preference.Type

export const Status = Schema.Struct({
  preference: Preference,
  revision: NonNegativeInt,
}).annotate({ identifier: "CybersecPreservationStatus" })
export type Status = typeof Status.Type

const decodeStored = Schema.decodeUnknownOption(
  Schema.Struct({ sessionId: SessionID, ...Status.fields }),
)

export function stored(session: Pick<Session.Info, "id" | "metadata">): Status {
  const vibeterm: unknown = session.metadata?.vibeterm
  const record = decodeStored(isRecord(vibeterm) ? vibeterm.cybersecPreservation : undefined)
  if (Option.isNone(record) || record.value.sessionId !== session.id) {
    return { preference: "inherit", revision: 0 }
  }
  return { preference: record.value.preference, revision: record.value.revision }
}

export * as CybersecPreservation from "./cybersec-preservation"
