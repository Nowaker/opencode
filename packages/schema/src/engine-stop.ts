export * as EngineStop from "./engine-stop.js"

import { Schema } from "effect"
import { Schedule } from "./schedule.js"
import { SessionMessage } from "./session-message.js"
import { NonNegativeInt, optional } from "./schema.js"

export const Generation = Schema.String.pipe(Schema.brand("EngineStop.Generation")).annotate({
  identifier: "EngineStop.Generation",
})
export type Generation = typeof Generation.Type

export const OperationID = Schema.String.pipe(Schema.brand("EngineStop.OperationID")).annotate({
  identifier: "EngineStop.OperationID",
})
export type OperationID = typeof OperationID.Type

export const Token = Schema.String.pipe(Schema.brand("EngineStop.Token")).annotate({
  identifier: "EngineStop.Token",
})
export type Token = typeof Token.Type

export const ActivityRevision = NonNegativeInt.pipe(Schema.brand("EngineStop.ActivityRevision")).annotate({
  identifier: "EngineStop.ActivityRevision",
})
export type ActivityRevision = typeof ActivityRevision.Type

export const Mode = Schema.Literals(["idle", "force-restart"]).annotate({ identifier: "EngineStop.Mode" })
export type Mode = typeof Mode.Type

export const WaitMillis = NonNegativeInt.check(Schema.isLessThanOrEqualTo(30_000)).annotate({
  identifier: "EngineStop.WaitMillis",
})
export type WaitMillis = typeof WaitMillis.Type

const identity = { generation: Generation, operationID: OperationID, mode: Mode, token: Token }

export const Refused = Schema.Struct({
  ...identity,
  mode: Schema.Literal("idle"),
  status: Schema.Literal("refused"),
  reason: Schema.Union([
    Schema.Struct({ type: Schema.Literal("work-active"), activeClaims: NonNegativeInt }),
    Schema.Struct({ type: Schema.Literal("activity-changed"), activityRevision: ActivityRevision }),
    Schema.Struct({ type: Schema.Literal("native-schedule-armed"), scheduleIDs: Schema.Array(Schedule.ID) }),
  ]),
}).annotate({ identifier: "EngineStop.Refused" })
export interface Refused extends Schema.Schema.Type<typeof Refused> {}

export const Preparing = Schema.Struct({ ...identity, status: Schema.Literal("preparing") }).annotate({
  identifier: "EngineStop.Preparing",
})
export interface Preparing extends Schema.Schema.Type<typeof Preparing> {}

export const Sealed = Schema.Struct({ ...identity, status: Schema.Literal("sealed") }).annotate({
  identifier: "EngineStop.Sealed",
})
export interface Sealed extends Schema.Schema.Type<typeof Sealed> {}

export const Cancelled = Schema.Struct({ ...identity, status: Schema.Literal("cancelled") }).annotate({
  identifier: "EngineStop.Cancelled",
})
export interface Cancelled extends Schema.Schema.Type<typeof Cancelled> {}

export const Operation = Schema.Union([Refused, Preparing, Sealed, Cancelled]).annotate({
  identifier: "EngineStop.Operation",
})
export type Operation = typeof Operation.Type

export const Info = Schema.Struct({
  generation: Generation,
  activityRevision: ActivityRevision,
  state: Schema.Literals(["open", "preparing", "sealed"]),
  activeClaims: NonNegativeInt,
  operation: Schema.NullOr(Operation),
}).annotate({ identifier: "EngineStop.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const GetQuery = Schema.Struct({
  operationID: OperationID.pipe(optional),
  waitMs: WaitMillis.pipe(optional),
}).annotate({
  identifier: "EngineStop.GetQuery",
})
export interface GetQuery extends Schema.Schema.Type<typeof GetQuery> {}

const prepareIdentity = {
  expectedGeneration: Generation,
  operationID: OperationID,
}

const prepareWait = { waitMs: WaitMillis.pipe(optional) }

export const PrepareInput = Schema.Union([
  Schema.Struct({
    ...prepareIdentity,
    ...prepareWait,
    mode: Schema.Literal("idle"),
    expectedActivityRevision: ActivityRevision,
  }),
  Schema.Struct({
    ...prepareIdentity,
    ...prepareWait,
    mode: Schema.Literal("force-restart"),
    expectedActivityRevision: Schema.optionalKey(Schema.Never),
  }),
]).annotate({ identifier: "EngineStop.PrepareInput" })
export type PrepareInput = typeof PrepareInput.Type

export const CancelInput = Schema.Struct({ ...prepareIdentity, token: Token }).annotate({
  identifier: "EngineStop.CancelInput",
})
export interface CancelInput extends Schema.Schema.Type<typeof CancelInput> {}

export class ControlError extends Schema.TaggedError<ControlError>()("EngineStop.ControlError", {
  reason: Schema.Literals([
    "generation-mismatch",
    "operation-conflict",
    "operation-active",
    "operation-not-found",
    "token-mismatch",
  ]),
  generation: Generation,
  operationID: OperationID,
  message: Schema.String,
}) {}

export class RefusedError extends Schema.TaggedError<RefusedError>()("EngineStop.RefusedError", {
  generation: Generation,
  operationID: OperationID,
  mode: Mode,
  operationState: Schema.Literals(["preparing", "sealed"]),
  retryable: Schema.Literal(true),
  admission: Schema.Union([
    Schema.Struct({ status: Schema.Literal("not-admitted") }),
    Schema.Struct({ status: Schema.Literal("existing"), inputID: SessionMessage.ID }),
  ]),
  message: Schema.String,
}) {}
