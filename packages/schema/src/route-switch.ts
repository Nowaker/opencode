export * as RouteSwitch from "./route-switch.js"

import { Schema } from "effect"
import { Session } from "./session.js"
import { NonNegativeInt, optional } from "./schema.js"

export const Preference = Schema.Literals(["inherit", "off", "on"])
export type Preference = typeof Preference.Type

export const Route = Schema.Struct({
  agent: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  providerID: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  modelID: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  variant: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
}).annotate({ identifier: "RouteSwitch.Route" })
export type Route = typeof Route.Type

export const Reason = Schema.Literals([
  "session-on",
  "session-off",
  "rule-on",
  "rule-off",
  "default-on",
  "default-off",
  "global-disabled",
  "pinned",
  "older-engine",
  "owner-unavailable",
  "policy-unavailable",
  "no-approved-alternate",
  "route-ineligible",
  "unsafe-step",
  "stale-evidence",
  "attempted",
  "alternate-active",
  "return-pending",
  "busy",
])
export type Reason = typeof Reason.Type

export const ReturnState = Schema.Literals(["preferred", "alternate", "returning", "return-off"])
export type ReturnState = typeof ReturnState.Type

export const QuotaStop = Schema.Struct({
  route: Route,
  reason: Schema.Literals(["quota_exhausted", "reserve_held"]),
}).annotate({ identifier: "RouteSwitch.QuotaStop" })
export interface QuotaStop extends Schema.Schema.Type<typeof QuotaStop> {}

const ownerEpoch = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))
const guard = { ownerEpoch, revision: NonNegativeInt }
const status = {
  version: Schema.Literal(1),
  sessionID: Session.ID,
  preference: Preference,
  reason: Reason,
  preferred: Schema.NullOr(Route),
  effective: Schema.NullOr(Route),
  returnPending: Schema.Boolean,
  returnPreference: Preference,
  returnEnabled: Schema.Boolean,
  returnState: ReturnState,
  next: Schema.NullOr(Route),
  previewExpiresAt: optional(NonNegativeInt),
  quotaStop: optional(QuotaStop),
}

export const Status = Schema.Union([
  Schema.Struct({ ...status, ...guard, availability: Schema.Literal("available"), enabled: Schema.Boolean }),
  Schema.Struct({
    ...status,
    availability: Schema.Literal("unavailable"),
    ownerEpoch: Schema.NullOr(ownerEpoch),
    revision: Schema.NullOr(NonNegativeInt),
    enabled: Schema.Literal(false),
  }),
]).annotate({ identifier: "RouteSwitch.Status" })
export type Status = typeof Status.Type

export const Mutation = Schema.Union([
  Schema.Struct({ ...guard, action: Schema.Literal("set-preference"), preference: Preference }),
  Schema.Struct({ ...guard, action: Schema.Literal("set-return-preference"), preference: Preference }),
  Schema.Struct({ ...guard, action: Schema.Literal("return-to-preferred") }),
]).annotate({ identifier: "RouteSwitch.Mutation" })
export type Mutation = typeof Mutation.Type

export type EditResult = { readonly status: 200 | 409 | 503; readonly data: Status }
