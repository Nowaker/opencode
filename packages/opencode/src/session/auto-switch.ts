import { Context, Effect, Schema } from "effect"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { OwnerQuiescence } from "@/owner/quiescence"
import type { Session } from "./session"
import type { SessionID } from "./schema"
import { AutoSwitchSchema } from "./auto-switch-schema"
import type { Plugin } from "@/plugin"
import type { Agent } from "@/agent/agent"
import { MeridianRouting } from "@/provider/meridian-routing"
import type { Provider } from "@/provider/provider"

const PolicyDecision = Schema.Struct({
  enabled: Schema.Boolean,
  reason: AutoSwitchSchema.Reason,
  alternates: Schema.Array(AutoSwitchSchema.Route),
  policyRevision: Schema.String,
  returnEnabled: Schema.optionalKey(Schema.Boolean),
})

type PolicyInput = {
  readonly sessionID: SessionID
  readonly title: string
  readonly projectDirectory: string
  readonly parentID: SessionID | null
  readonly agent: string
  readonly source: AutoSwitchSchema.Route | null
  readonly preference: typeof AutoSwitchSchema.Preference.Type
  readonly returnPreference: typeof AutoSwitchSchema.Preference.Type
  readonly pins: { readonly provider: boolean; readonly account: boolean; readonly security: boolean }
  readonly phase2Capability: "reverse-routing-v1"
  readonly catalog?: readonly { readonly providerID: string; readonly modelID: string; readonly variants: readonly string[] }[]
}

type PolicyReader = (input: PolicyInput) => unknown

const policyModule = process.env.VIBETERM_AUTO_SWITCH_POLICY_MODULE
const startupPolicy = async (input: PolicyInput) => {
  if (!policyModule || !path.isAbsolute(policyModule)) return undefined
  const mod: { readonly readAutoSwitchPolicy?: PolicyReader } = await import(pathToFileURL(policyModule).href)
  return mod.readAutoSwitchPolicy?.(input)
}

export const Policy = Context.Reference<PolicyReader>("AutoSwitch.Policy", { defaultValue: () => startupPolicy })

let root: SessionID | undefined
const serving = new Map<SessionID, AutoSwitchSchema.Episode>()
const cleanEnds = new Set<SessionID>()
const idleSince = new Map<SessionID, number>()

export function noteCleanEnd(sessionID: SessionID) {
  cleanEnds.add(sessionID)
}

export function noteIdle(sessionID: SessionID) {
  if (!cleanEnds.delete(sessionID)) return
  idleSince.set(sessionID, Date.now())
  if (idleSince.size > 128) {
    const oldest = idleSince.keys().next()
    if (!oldest.done) idleSince.delete(oldest.value)
  }
}

export function begin(sessionID: SessionID) {
  cleanEnds.delete(sessionID)
  const previous = idleSince.get(sessionID)
  idleSince.delete(sessionID)
  return previous
}
export type BlockedReason = Extract<AutoSwitchSchema.Reason, "unsafe-step" | "stale-evidence" | "route-ineligible" | "attempted">
const blocked = new Map<SessionID, { readonly revision: number; readonly reason: BlockedReason }>()

export function noteBlocked(sessionID: SessionID, revision: number, reason: BlockedReason) {
  blocked.delete(sessionID)
  blocked.set(sessionID, { revision, reason })
  if (blocked.size <= 128) return
  const oldest = blocked.keys().next()
  if (!oldest.done) blocked.delete(oldest.value)
}

export function clearBlocked(sessionID: SessionID) {
  blocked.delete(sessionID)
}

export function markServing(episode: AutoSwitchSchema.Episode) {
  serving.set(episode.sessionId, episode)
}

export function stopServing(sessionID: SessionID) {
  serving.delete(sessionID)
}

export function bindOwner(sessionID: SessionID) {
  if (root === undefined) root = sessionID
  return root === sessionID
}

export const Owner = Context.Reference<() => SessionID | undefined>("AutoSwitch.Owner", {
  defaultValue: () => () => root,
})

const inScope = Effect.fnUntraced(function* (sessions: Session.Interface, session: Session.Info) {
  const selected = (yield* Owner)()
  if (!selected || OwnerQuiescence.status().sealed) return false
  let current = session
  const visited = new Set([current.id])
  while (current.id !== selected) {
    if (!current.parentID || visited.has(current.parentID) || visited.size >= 100) return false
    const parent = yield* sessions.get(current.parentID).pipe(Effect.option)
    if (parent._tag === "None") return false
    current = parent.value
    visited.add(current.id)
  }
  return !OwnerQuiescence.status().sealed && session.time.archived === undefined
})

export function preferred(session: Session.Info): AutoSwitchSchema.Route | null {
  if (!session.model || !session.agent) return null
  return {
    providerID: session.model.providerID,
    modelID: session.model.id,
    agent: session.agent,
    variant: session.model.variant === "default" ? null : (session.model.variant ?? null),
  }
}

export function same(left: AutoSwitchSchema.Route | null, right: AutoSwitchSchema.Route | null) {
  return (
    left?.agent === right?.agent &&
    left?.providerID === right?.providerID &&
    left?.modelID === right?.modelID &&
    left?.variant === right?.variant
  )
}

export function eligiblePair(source: AutoSwitchSchema.Route, target: AutoSwitchSchema.Route) {
  const from = MeridianRouting.routeProvider(source.providerID)
  const to = MeridianRouting.routeProvider(target.providerID)
  return !!from && !!to && from !== to && !!source.variant && !!target.variant
}

function identity(name: string) {
  return name.toLowerCase().split(/ \(| - /)[0]
}

export function sameCandidate(candidate: AutoSwitchSchema.Route, resolved: AutoSwitchSchema.Route) {
  return (
    same(candidate, resolved) ||
    (["hephaestus", "sisyphus"].includes(candidate.agent) &&
      identity(resolved.agent) === candidate.agent &&
      same({ ...candidate, agent: resolved.agent }, resolved))
  )
}

export const authorizeAgent = Effect.fnUntraced(function* (input: {
  readonly sessionID: SessionID
  readonly source: AutoSwitchSchema.Route
  readonly target: AutoSwitchSchema.Route
  readonly sourceAgent: Agent.Info
  readonly targetAgent: Agent.Info
  readonly plugin: Plugin.Interface
}) {
  if (!eligiblePair(input.source, input.target)) return false
  if (input.source.agent === input.target.agent) {
    if (["sisyphus", "hephaestus"].includes(identity(input.source.agent))) return false
    return !input.sourceAgent.model || (
      input.sourceAgent.model.providerID === input.source.providerID && input.sourceAgent.model.modelID === input.source.modelID &&
      (!input.sourceAgent.variant || input.sourceAgent.variant === input.source.variant)
    )
  }
  const toClaude = MeridianRouting.routeProvider(input.target.providerID) === "claude"
  if (
    identity(input.source.agent) !== (toClaude ? "hephaestus" : "sisyphus") ||
    identity(input.target.agent) !== (toClaude ? "sisyphus" : "hephaestus")
  ) return false
  if (
    input.targetAgent.mode !== "primary" ||
    input.targetAgent.hidden ||
    !input.targetAgent.prompt ||
    input.targetAgent.model?.providerID !== input.target.providerID ||
    input.targetAgent.model.modelID !== input.target.modelID ||
    input.targetAgent.variant !== input.target.variant ||
    input.sourceAgent.model?.providerID !== input.source.providerID ||
    input.sourceAgent.model.modelID !== input.source.modelID ||
    input.sourceAgent.variant !== input.source.variant
  )
    return false
  const hooks = (yield* input.plugin.list()).flatMap((entry) => entry["experimental.chat.autoSwitch.prepare"] ?? [])
  const hook = hooks.length === 1 ? hooks[0] : undefined
  if (!hook) return false
  const output: { decision?: "allow" | "deny" } = {}
  const result = yield* Effect.tryPromise(() =>
    hook(
      {
        version: 1,
        sessionID: input.sessionID,
        source: { ...input.source },
        target: { ...input.target },
      },
      output,
    ),
  ).pipe(Effect.option)
  return result._tag === "Some" && output.decision === "allow"
})

export function stored(session: Session.Info) {
  const preference = Schema.decodeUnknownOption(AutoSwitchSchema.StoredPreference)(
    session.metadata?.vibeterm?.autoSwitch,
  )
  const episode = Schema.decodeUnknownOption(AutoSwitchSchema.Episode)(session.metadata?.vibeterm?.autoSwitchEpisode)
  return {
    preference:
      preference._tag === "Some" && preference.value.sessionId === session.id
        ? preference.value.preference
        : ("inherit" as const),
    revision: preference._tag === "Some" && preference.value.sessionId === session.id ? preference.value.revision : 0,
    returnPreference: preference._tag === "Some" && preference.value.sessionId === session.id
      ? preference.value.returnPreference ?? "inherit" : "inherit" as const,
    episode: episode._tag === "Some" && episode.value.sessionId === session.id ? episode.value : undefined,
  }
}

type CatalogReader = Provider.Interface["list"]

export const inspect = Effect.fnUntraced(function* (sessions: Session.Interface, sessionID: SessionID, catalogReader?: CatalogReader) {
  const value = yield* sessions.get(sessionID).pipe(Effect.option)
  if (value._tag === "None" || !(yield* inScope(sessions, value.value))) return undefined
  const session = value.value
  const source = preferred(session)
  const state = stored(session)
  const policy = yield* Policy
  const catalog = source && MeridianRouting.routeProvider(source.providerID) && catalogReader
    ? Object.values(yield* catalogReader()).flatMap((provider) => Object.values(provider.models).flatMap((model) =>
        model.api.id === model.id && MeridianRouting.routeProvider(model.providerID)
          ? [{ providerID: model.providerID, modelID: model.id, variants: Object.keys(model.variants ?? {}) }]
          : [],
      ))
    : undefined
  const decision = yield* Effect.tryPromise(() =>
    Promise.resolve(
      policy({
        sessionID,
        title: session.title,
        projectDirectory: session.directory,
        parentID: session.parentID ?? null,
        agent: source?.agent ?? session.agent ?? "",
        source,
        phase2Capability: "reverse-routing-v1",
        catalog,
        preference: state.preference,
        returnPreference: state.returnPreference,
        pins: {
          provider: !!source && /(?:^|[-_])(?:pinned|cybersec)(?:[-_]|$)/i.test(source.providerID),
          account: !!source && /(?:^|[-_])(?:pinned|account)(?:[-_]|$)/i.test(source.providerID),
          security: !!source && /(?:^|[-_])cybersec(?:[-_]|$)/i.test(`${source.providerID}-${source.agent}`),
        },
      }),
    ),
  ).pipe(Effect.option)
  const parsed = decision._tag === "Some" ? Schema.decodeUnknownOption(PolicyDecision)(decision.value) : undefined
  return { session, source, ...state, policy: parsed?._tag === "Some" ? parsed.value : undefined }
})

type Inspection = NonNullable<Effect.Success<ReturnType<typeof inspect>>>

export function returnEnabled(current: Pick<Inspection, "policy" | "returnPreference">) {
  return current.returnPreference === "inherit" ? current.policy?.returnEnabled ?? true : current.returnPreference === "on"
}

function status(sessionID: SessionID, current: Inspection | undefined, returnReady = false): AutoSwitchSchema.Status {
  const episode = current?.episode
  const source = current?.source ?? null
  const active =
    !!episode &&
    (["active", "failed"].includes(episode.state) || serving.get(sessionID)?.at === episode.at) &&
    same(episode.source, source)
  const available =
    !!current?.policy && !["pinned", "global-disabled", "policy-unavailable"].includes(current.policy.reason)
  const rejection = blocked.get(sessionID)
  const blockedReason = available && current?.policy?.enabled && rejection?.revision === current?.revision
    ? rejection?.reason : undefined
  const policyReason = current?.policy?.reason ?? (current ? "policy-unavailable" : "owner-unavailable")
  const eligible = !!current?.policy?.enabled && available
  const autoReturn = eligible && returnEnabled(current)
  const servingAlternate = active && eligible && !episode.returnPending &&
    current?.policy?.alternates.some((route) => sameCandidate(route, episode.target))
  const returnState = !servingAlternate ? "preferred" : !autoReturn ? "return-off" : returnReady ? "returning" : "alternate"
  return {
    version: 1,
    sessionID,
    availability: available ? "available" : "unavailable",
    ownerEpoch: current ? OwnerQuiescence.status().ownerID : null,
    revision: current?.revision ?? null,
    preference: current?.preference ?? "inherit",
    enabled: available && !!current?.policy?.enabled,
    reason: active && episode.returnPending ? "return-pending" :
      blockedReason ?? (active ? (episode.state === "failed" ? "attempted" : "alternate-active") : policyReason),
    preferred: source,
    effective: active ? episode.target : source,
    returnPending: active && episode.returnPending,
    returnPreference: current?.returnPreference ?? "inherit",
    returnEnabled: autoReturn,
    returnState,
    next: returnState === "returning" || !servingAlternate ? source : episode.target,
  }
}

export const read = Effect.fnUntraced(function* (sessions: Session.Interface, sessionID: SessionID, catalogReader?: CatalogReader) {
  const current = yield* inspect(sessions, sessionID, catalogReader)
  const idle = idleSince.get(sessionID)
  if (idle === undefined || !current?.policy?.enabled || !returnEnabled(current) || !current.source ||
    current.episode?.state !== "active" || current.episode.returnPending || current.episode.returnCooldown ||
    !same(current.episode.source, current.source)) {
    return status(sessionID, current)
  }
  const validUntil = yield* MeridianRouting.probePreferred(current.source)
  const latest = yield* inspect(sessions, sessionID, catalogReader)
  return status(sessionID, latest, validUntil !== undefined && validUntil >= Date.now() && idle === idleSince.get(sessionID) &&
    latest?.revision === current.revision && latest?.policy?.policyRevision === current.policy.policyRevision &&
    same(latest?.source ?? null, current.source))
})

export function save(
  sessions: Session.Interface,
  current: Inspection,
  change: {
    readonly episode: AutoSwitchSchema.Episode | undefined
    readonly preference?: typeof AutoSwitchSchema.Preference.Type
    readonly returnPreference?: typeof AutoSwitchSchema.Preference.Type
    readonly valid?: () => Effect.Effect<boolean>
  },
) {
  return sessions.updateAutoSwitch({
    sessionID: current.session.id,
    revision: current.revision,
    preference: change.preference ?? current.preference,
    returnPreference: change.returnPreference ?? current.returnPreference,
    episode: change.episode,
    current: (row) =>
      !OwnerQuiescence.status().sealed &&
      row.time.archived === undefined &&
      row.title === current.session.title &&
      row.directory === current.session.directory &&
      row.parentID === current.session.parentID &&
      same(preferred(row), current.source)
        ? (change.valid?.() ?? Effect.succeed(true))
        : Effect.succeed(false),
  })
}

export const settle = Effect.fnUntraced(function* (
  sessions: Session.Interface,
  claim: AutoSwitchSchema.Episode,
  failed: boolean,
) {
  for (let retry = 0; retry < 3; retry++) {
    const current = yield* inspect(sessions, claim.sessionId)
    const episode = current?.episode
    if (!current || episode?.state !== "claimed" || episode.at !== claim.at) return
    if (
      yield* save(sessions, current, {
        episode: {
          ...episode,
          state: episode.returnPending ? "returned" : failed ? "failed" : "active",
          returnPending: false,
        },
      })
    )
      return
  }
})

export const finishBoundary = Effect.fnUntraced(function* (
  sessions: Session.Interface,
  active: AutoSwitchSchema.Episode,
) {
  const current = yield* inspect(sessions, active.sessionId)
  if (!current?.episode?.returnPending || current.episode.at !== active.at) return
  yield* save(sessions, current, { episode: { ...current.episode, state: "returned", returnPending: false } })
})

export const mutate = Effect.fnUntraced(function* (
  sessions: Session.Interface,
  sessionID: SessionID,
  input: AutoSwitchSchema.Mutation,
  catalogReader?: CatalogReader,
) {
  const current = yield* inspect(sessions, sessionID, catalogReader)
  const view = status(sessionID, current)
  if (!current || view.availability === "unavailable") {
    return { statusCode: view.reason === "pinned" ? (409 as const) : (503 as const), status: view }
  }
  if (input.ownerEpoch !== view.ownerEpoch || input.revision !== view.revision) {
    return { statusCode: 409 as const, status: yield* read(sessions, sessionID, catalogReader) }
  }
  const returns = input.action === "return-to-preferred" || (input.action === "set-preference" && input.preference === "off")
  const episode = current.episode
  const inFlight = !!episode && serving.get(sessionID)?.at === episode.at
  const saved = yield* save(sessions, current, {
    preference: input.action === "set-preference" ? input.preference : undefined,
    returnPreference: input.action === "set-return-preference" ? input.preference : undefined,
    episode:
      returns && episode && (episode.state === "active" || episode.state === "failed" || inFlight)
        ? { ...episode, state: inFlight ? episode.state : "returned", returnPending: inFlight }
        : episode,
  })
  return { statusCode: saved ? (200 as const) : (409 as const), status: yield* read(sessions, sessionID, catalogReader) }
})

export * as AutoSwitch from "./auto-switch"
