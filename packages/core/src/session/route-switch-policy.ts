import path from "node:path"
import { Effect, Option, Schema } from "effect"
import { RouteSwitch } from "@opencode/schema/route-switch"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import type { SessionRouteSwitchState } from "./route-switch-state.js"
import type { SessionSchema } from "./schema.js"

const Policy = Schema.Struct({
  enabled: Schema.Boolean,
  returnEnabled: Schema.Boolean,
  reason: RouteSwitch.Reason,
  alternates: Schema.Array(RouteSwitch.Route),
  policyRevision: Schema.String,
})
type Policy = typeof Policy.Type
const decode = Schema.decodeUnknownOption(Policy)
const unavailable: Policy = {
  enabled: false,
  returnEnabled: false,
  reason: "policy-unavailable",
  alternates: [],
  policyRevision: "unavailable",
}

export const sameRoute = (a: RouteSwitch.Route | null | undefined, b: RouteSwitch.Route | null | undefined) =>
  a != null &&
  b != null &&
  a.agent === b.agent &&
  a.providerID === b.providerID &&
  a.modelID === b.modelID &&
  a.variant === b.variant

export const exactRoute = (agent: Agent.ID, ref: Model.Ref): RouteSwitch.Route => ({
  agent,
  providerID: ref.providerID,
  modelID: ref.id,
  variant: ref.variant ?? null,
})

export const matchesAgentPin = (pin: Model.Ref | undefined, route: RouteSwitch.Route) =>
  pin !== undefined &&
  pin.providerID === route.providerID &&
  pin.id === route.modelID &&
  (pin.variant === undefined || pin.variant === route.variant)

export const selectionOf = (route: RouteSwitch.Route) => ({
  agent: Agent.ID.make(route.agent),
  model: Model.Ref.make({
    providerID: Provider.ID.make(route.providerID),
    id: Model.ID.make(route.modelID),
    variant: route.variant === null ? undefined : Model.VariantID.make(route.variant),
  }),
})

export const hasRoutingPin = (headers: Readonly<Record<string, string>> | undefined) =>
  Object.keys(headers ?? {}).some((name) =>
    ["x-meridian-profile", "x-meridian-require", "x-meridian-internal-hop", "chatgpt-account-id", "host"].includes(
      name.toLowerCase(),
    ),
  )

type PolicyInput = {
  readonly sessionID: string
  readonly parentID: string | null
  readonly title: string
  readonly agent: string
  readonly projectDirectory: string
  readonly source: RouteSwitch.Route | null
  readonly preference: RouteSwitch.Preference
  readonly returnPreference: RouteSwitch.Preference
  readonly pins: { readonly provider: boolean; readonly account: boolean; readonly security: boolean }
  readonly catalog?: Catalog
}
export type Catalog = readonly {
  readonly providerID: string
  readonly modelID: string
  readonly variants: readonly (string | null)[]
}[]

export const load = Effect.gen(function* () {
  const file = process.env.VIBETERM_AUTO_SWITCH_POLICY_MODULE
  const module: unknown =
    file && path.isAbsolute(file)
      ? yield* Effect.tryPromise(() => import(file)).pipe(Effect.orElseSucceed(() => undefined))
      : undefined
  const reader =
    module && typeof module === "object" && "readAutoSwitchPolicy" in module ? module.readAutoSwitchPolicy : undefined
  return (
    session: SessionSchema.Info,
    state: SessionRouteSwitchState.State,
    source: RouteSwitch.Route | null,
    catalog?: Catalog,
  ) => {
    if (typeof reader !== "function") return unavailable
    const providerID = source?.providerID
    const input: PolicyInput = {
      sessionID: session.id,
      parentID: session.parentID ?? null,
      title: session.title ?? "",
      agent: source?.agent ?? session.agent ?? "",
      projectDirectory: session.location.directory,
      source,
      catalog,
      preference: state.preference,
      returnPreference: state.returnPreference,
      pins: {
        provider: providerID != null && providerID !== "openai" && providerID !== "anthropic",
        account: source?.modelID.includes("/") ?? false,
        security: providerID === "anthropic-cybersec",
      },
    }
    try {
      const result = decode(reader(input))
      if (Option.isNone(result)) return unavailable
      if (input.pins.provider || input.pins.account || input.pins.security)
        return { ...result.value, enabled: false, reason: "pinned" as const, alternates: [] }
      return result.value
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return unavailable
    }
  }
})
