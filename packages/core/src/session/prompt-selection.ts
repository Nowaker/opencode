import type { RouteSwitch } from "@opencode/schema/route-switch"
import { Effect } from "effect"
import { Agent } from "../agent.js"
import type { Database } from "../database/database.js"
import { Model } from "../model.js"
import { SessionRouteSwitch } from "./route-switch.js"
import { SessionRouteSwitchState } from "./route-switch-state.js"
import { exactRoute, hasRoutingPin, sameRoute, selectionOf } from "./route-switch-policy.js"
import { SessionRunnerModel } from "./runner/model.js"
import { SessionSchema } from "./schema.js"
import type { SessionStore } from "./store.js"

export const check = Effect.fnUntraced(function* (input: {
  readonly session: SessionSchema.Info
  readonly db: Database.Interface["db"]
  readonly store: SessionStore.Interface
  readonly selection: RouteSwitch.PromptSelection
}) {
  const sessionID = input.session.id
  const fail = (reason: "selection-stale" | "selection-unavailable" | "selection-pinned") =>
    new SessionSchema.PromptGuardError({ accepted: false, reason, sessionID })
  if (input.selection.ownerEpoch !== SessionRouteSwitch.ownerEpoch) return yield* fail("selection-stale")
  const current = yield* input.store.get(sessionID)
  if (
    !current ||
    current.time.archived ||
    current.revert ||
    current.location.directory !== input.session.location.directory ||
    current.location.workspaceID !== input.session.location.workspaceID
  )
    return yield* fail("selection-stale")
  if (!input.selection.route) return

  const state = yield* SessionRouteSwitchState.read(input.db, sessionID, current.parentID !== undefined)
  if (state.revision !== input.selection.revision) return yield* fail("selection-stale")
  const target = selectionOf(input.selection.route)
  const agents = yield* Agent.Service
  const models = yield* Model.Service
  const resolver = yield* SessionRunnerModel.Service
  const agent = yield* agents.get(target.agent)
  if (!agent || agent.hidden || (agent.mode === "subagent" && target.agent !== current.agent))
    return yield* fail("selection-unavailable")
  const source = yield* agents.resolve(current.agent)
  const preferred = current.model ?? source?.model
  const registeredSource = preferred && (yield* models.get(preferred.providerID, preferred.id))
  const configuredPin =
    hasRoutingPin(source?.request.headers) ||
    hasRoutingPin(registeredSource?.headers) ||
    hasRoutingPin(registeredSource?.variants.find((variant) => variant.id === preferred?.variant)?.headers)
  if (
    configuredPin &&
    preferred &&
    !sameRoute(exactRoute(source?.id ?? target.agent, preferred), input.selection.route)
  )
    return yield* fail("selection-pinned")
  if (
    violatesPin(preferred, target.model) ||
    (source?.model && source.id === target.agent && source.model.providerID !== target.model.providerID) ||
    (agent.model && agent.model.providerID !== target.model.providerID)
  )
    return yield* fail("selection-pinned")
  const available = yield* models.available()
  const info = available.find((model) => model.providerID === target.model.providerID && model.id === target.model.id)
  if (
    !info ||
    (target.model.variant !== undefined && !info.variants.some((variant) => variant.id === target.model.variant))
  )
    return yield* fail("selection-unavailable")
  if (
    (hasRoutingPin(agent.request.headers) ||
      hasRoutingPin(info.headers) ||
      hasRoutingPin(info.variants.find((variant) => variant.id === target.model.variant)?.headers)) &&
    (!preferred || !sameRoute(exactRoute(source?.id ?? target.agent, preferred), input.selection.route))
  )
    return yield* fail("selection-pinned")
  const resolved = yield* resolver
    .resolve({ ...current, ...target }, () => Effect.succeed(available), {
      kind: "primary",
      agent: target.agent,
    })
    .pipe(Effect.orElseSucceed(() => undefined))
  if (!resolved || !sameRoute(exactRoute(target.agent, resolved.ref), input.selection.route))
    return yield* fail("selection-unavailable")

  yield* SessionRouteSwitchState.write(input.db, sessionID, { ...state, revision: state.revision + 1 })
})

function violatesPin(source: Model.Ref | undefined, target: Model.Ref) {
  if (!source) return false
  const provider = source.providerID
  if (provider === "anthropic-cybersec" && target.providerID !== provider) return true
  if (provider !== "anthropic-cybersec" && provider !== "anthropic-meridian" && provider !== "openai-meridian")
    return false
  const slash = source.id.indexOf("/")
  return slash > 0 && (target.providerID !== provider || !target.id.startsWith(source.id.slice(0, slash + 1)))
}
