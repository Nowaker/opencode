export * as CybersecPreservationEvent from "./cybersec-preservation-event"

import { Schema } from "effect"
import { define } from "./event"
import { NonNegativeInt } from "./schema"
import { SessionID } from "./session-id"

export const Updated = define({
  type: "vibeterm.session.cybersec_preservation.updated",
  schema: {
    version: Schema.Literal(1),
    sessionID: SessionID,
    revision: NonNegativeInt,
  },
})
