export * as ShellBackgroundEvent from "./shell-background-event"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { NonNegativeInt, optional } from "./schema"
import { SessionID } from "./session-id"

/** A bash command now running in the background: asked for with `run_in_background`, or still running at its timeout. */
export const Started = define({
  type: "shell.background.started",
  schema: {
    sessionID: SessionID,
    messageID: Schema.String,
    callID: Schema.String,
    id: Schema.String,
    command: Schema.String,
    outputPath: Schema.String,
    reason: Schema.Literals(["requested", "timeout"]),
    /** The longest it may run, counted from its start, or null for no limit. */
    timeoutMs: Schema.NullOr(NonNegativeInt),
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
  },
})

export const Definitions = inventory(Started, Exited)
