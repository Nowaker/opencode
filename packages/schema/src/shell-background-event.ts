export * as ShellBackgroundEvent from "./shell-background-event"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { NonNegativeInt, optional } from "./schema"
import { SessionID } from "./session-id"

/** A bash command now running in the background. */
export const Started = define({
  type: "shell.background.started",
  schema: {
    sessionID: SessionID,
    messageID: Schema.String,
    callID: Schema.String,
    id: Schema.String,
    command: Schema.String,
    outputPath: Schema.String,
    reason: Schema.Literals(["requested", "timeout", "user"]),
    /** The longest it may run, counted from its start, or null for no limit. */
    timeoutMs: Schema.NullOr(NonNegativeInt),
  },
})

const lineBatch = {
  sequence: Schema.Int,
  lines: Schema.Array(Schema.String),
  suppressed: NonNegativeInt,
}

export const Lines = define({
  type: "shell.background.lines",
  schema: {
    sessionID: SessionID,
    id: Schema.String,
    outputPath: Schema.String,
    ...lineBatch,
  },
})

/** A background bash command ended. `output` is the tail of what it printed; the whole output is in `outputPath`. */
export const Exited = define({
  type: "shell.background.exited",
  schema: {
    sessionID: SessionID,
    id: Schema.String,
    command: Schema.String,
    status: Schema.Literals(["completed", "failed", "timeout", "cancelled"]),
    exitCode: optional(Schema.Int),
    durationMs: NonNegativeInt,
    outputPath: Schema.String,
    output: Schema.String,
    finalLines: optional(Schema.Struct(lineBatch)),
  },
})

export const Definitions = inventory(Started, Lines, Exited)
