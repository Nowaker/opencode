export * as Cancellation from "./cancellation.js"

import { Schema } from "effect"

export const Result = Schema.Union([
  Schema.Struct({ status: Schema.Literal("cancelled") }),
  Schema.Struct({ status: Schema.Literal("terminal"), state: Schema.Literals(["completed", "error", "cancelled"]) }),
  Schema.Struct({ status: Schema.Literal("requested") }),
  Schema.Struct({ status: Schema.Literal("unsupported"), reason: Schema.String }),
]).annotate({ identifier: "Cancellation.Result" })
export type Result = typeof Result.Type
