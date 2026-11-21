import { Schema } from "effect"
import { SessionID } from "./schema"

export const Route = Schema.Struct({
  agent: Schema.String,
  providerID: Schema.String,
  modelID: Schema.String,
  variant: Schema.NullOr(Schema.String),
}).annotate({ identifier: "AutoSwitchRoute" })
export type Route = typeof Route.Type

export const Preference = Schema.Literals(["inherit", "on", "off"])
export const Reason = Schema.Literals([
  "session-on",
  "session-off",
  "rule-on",
  "rule-off",
  "default-on",
  "default-off",
  "pinned",
  "older-engine",
  "owner-unavailable",
  "no-approved-alternate",
  "route-ineligible",
  "unsafe-step",
  "stale-evidence",
  "attempted",
  "alternate-active",
  "return-pending",
  "global-disabled",
  "policy-unavailable",
  "busy",
])
export type Reason = typeof Reason.Type
const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export const Status = Schema.Struct({
  version: Schema.Literal(1),
  sessionID: SessionID,
  availability: Schema.Literals(["available", "unavailable"]),
  ownerEpoch: Schema.NullOr(Schema.String),
  revision: Schema.NullOr(Revision),
  preference: Preference,
  enabled: Schema.Boolean,
  reason: Reason,
  preferred: Schema.NullOr(Route),
  effective: Schema.NullOr(Route),
  returnPending: Schema.Boolean,
  returnPreference: Schema.optionalKey(Preference),
  returnEnabled: Schema.optionalKey(Schema.Boolean),
  returnState: Schema.optionalKey(Schema.Literals(["preferred", "alternate", "returning", "return-off"])),
  next: Schema.optionalKey(Schema.NullOr(Route)),
}).annotate({ identifier: "AutoSwitchStatus" })
export type Status = typeof Status.Type

const revisioned = { ownerEpoch: Schema.String, revision: Revision }
export const Mutation = Schema.Union([
  Schema.Struct({ action: Schema.Literal("set-preference"), preference: Preference, ...revisioned }),
  Schema.Struct({ action: Schema.Literal("set-return-preference"), preference: Preference, ...revisioned }),
  Schema.Struct({ action: Schema.Literal("return-to-preferred"), ...revisioned }),
]).annotate({ identifier: "AutoSwitchMutation" })
export type Mutation = typeof Mutation.Type

export const StoredPreference = Schema.Struct({
  sessionId: SessionID, revision: Revision, preference: Preference, returnPreference: Schema.optionalKey(Preference),
})
export const Episode = Schema.Struct({
  sessionId: SessionID,
  turnID: Schema.String,
  step: Schema.Int,
  source: Route,
  target: Route,
  state: Schema.Literals(["claimed", "active", "returned", "failed"]),
  returnPending: Schema.Boolean,
  at: Schema.Int,
  autoReturnedTurnID: Schema.optionalKey(Schema.String),
  returnCooldown: Schema.optionalKey(Schema.Boolean),
})
export type Episode = typeof Episode.Type

export * as AutoSwitchSchema from "./auto-switch-schema"
