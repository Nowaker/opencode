import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { Option, Schema } from "effect"
import { createEffect, createMemo, on, onCleanup, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { errorMessage } from "../../util/error"
import { Locale } from "../../util/locale"
import { isRecord } from "../../util/record"

// Per-session cross-provider auto-switch: the engine owner's status read model and the two
// owner-bound mutations, `GET`/`PUT /session/{sessionID}/auto-switch`. The engine alone decides
// and acts; this side only shows what the owner acknowledged and asks it for a change.

const Route = Schema.Struct({
  agent: Schema.String,
  providerID: Schema.String,
  modelID: Schema.String,
  variant: Schema.NullOr(Schema.String),
})

const Reason = Schema.Literals([
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

const Preference = Schema.Literals(["on", "off", "inherit"])

const Status = Schema.Struct({
  version: Schema.Literal(1),
  sessionID: Schema.String,
  availability: Schema.Literals(["available", "unavailable"]),
  ownerEpoch: Schema.NullOr(Schema.String),
  revision: Schema.NullOr(Schema.Number),
  preference: Preference,
  enabled: Schema.Boolean,
  reason: Reason,
  returnPending: Schema.Boolean,
  // Automatic return: an older owner sends none of these four, a newer one all of them.
  returnPreference: Schema.optional(Preference),
  returnEnabled: Schema.optional(Schema.Boolean),
  returnState: Schema.optional(Schema.Literals(["preferred", "alternate", "returning", "return-off"])),
  preferred: Schema.NullOr(Route),
  effective: Schema.NullOr(Route),
  // A preview of the route the next provider turn takes; never a pick for the composer.
  next: Schema.optional(Schema.NullOr(Route)),
})

export type AutoSwitchRoute = typeof Route.Type
export type AutoSwitchReason = typeof Reason.Type
export type AutoSwitchStatus = typeof Status.Type
export type AutoSwitchPreference = AutoSwitchStatus["preference"]
export type AutoSwitchMutation =
  | { action: "set-preference"; preference: AutoSwitchPreference; ownerEpoch: string; revision: number }
  | { action: "set-return-preference"; preference: AutoSwitchPreference; ownerEpoch: string; revision: number }
  | { action: "return-to-preferred"; ownerEpoch: string; revision: number }

// What one response says. `unconfirmed` means the request may or may not have reached the owner.
export type AutoSwitchReply =
  | { type: "status"; status: AutoSwitchStatus }
  | { type: "conflict"; status: AutoSwitchStatus }
  | { type: "unavailable"; status?: AutoSwitchStatus }
  | { type: "unsupported" }
  | { type: "invalid" }
  | { type: "rejected"; message: string }
  | { type: "unconfirmed"; message: string }

type Pending =
  | { kind: "switch"; preference: AutoSwitchPreference }
  | { kind: "auto-return"; preference: AutoSwitchPreference }
  | { kind: "return" }
type Notice = { kind: "stale" | "failed" | "unconfirmed"; text: string }

export type AutoSwitchState = {
  phase: "loading" | "ready" | "unavailable" | "unsupported" | "invalid" | "error"
  status?: AutoSwitchStatus
  pending?: Pending
  // The status revision a notice was raised against; a newer acknowledged status retires it.
  notice?: Notice & { key: string }
  error?: string
}

type Toggle = { text: string; on: boolean; detail?: string }

export type AutoSwitchView = Toggle & {
  disabled?: string
  saving: boolean
  notice?: Notice
  autoReturn?: Toggle
  // The route row: shown while an alternate is in use or the next turn leaves the current route.
  active?: { using?: string; preferred: string; next?: string; context?: string; planned?: string; returning: boolean; canReturn: boolean }
}

const decodeStatus = Schema.decodeUnknownOption(Status)

// Reads one answer by its HTTP status and decoded body. The body is decoded here, not trusted from
// the generated types, so an engine on another contract version fails closed.
export function interpretAutoSwitch(code: number, body: unknown): AutoSwitchReply {
  if ([404, 405, 501].includes(code)) return { type: "unsupported" }
  const status = Option.getOrUndefined(decodeStatus(body))
  if (code === 503) return status ? { type: "unavailable", status } : { type: "unavailable" }
  if ((code >= 200 && code < 300) || code === 409) {
    if (!status) return { type: "invalid" }
    return code === 409 ? { type: "conflict", status } : { type: "status", status }
  }
  if (code >= 400 && code < 500) return { type: "rejected", message: bodyMessage(body) ?? `HTTP ${code}` }
  return { type: "unconfirmed", message: `HTTP ${code}` }
}

// Every request first asks the engine whether it serves auto-switch at all: an older one can pass the
// session path to a catch-all proxy, so without the capability neither route is ever sent.
export function autoSwitchTransport(sdk: { client: OpencodeClient }) {
  return async (sessionID: string, mutation?: AutoSwitchMutation): Promise<AutoSwitchReply> => {
    const health = await settle(sdk.client.global.health())
    if (!health.response) return { type: "rejected", message: `engine unreachable: ${errorMessage(health.error)}` }
    if (!health.response.ok) return { type: "rejected", message: `engine health HTTP ${health.response.status}` }
    if (health.data?.autoSwitch !== 1) return { type: "unsupported" }
    const result = await settle(
      mutation
        ? sdk.client.session.autoSwitch.update({ sessionID, autoSwitchMutation: mutation })
        : sdk.client.session.autoSwitch.status({ sessionID }),
    )
    if (!result.response) return { type: "unconfirmed", message: errorMessage(result.error) }
    return interpretAutoSwitch(result.response.status, result.response.ok ? result.data : result.error)
  }
}

// A generated call's result, with a thrown failure (network, interceptor) as one that has no response.
function settle<T extends { data?: unknown; error?: unknown }>(call: Promise<T>) {
  return call.then(
    (result) => result as T & { response?: Response },
    (error: unknown) => ({ error, data: undefined, response: undefined }) as Partial<T> & { response?: Response },
  )
}

export function describeAutoSwitch(state: AutoSwitchState): AutoSwitchView {
  const status = state.status
  const saving = state.pending !== undefined
  const notice = state.notice ? { kind: state.notice.kind, text: state.notice.text } : undefined
  const blocked = blockedReason(state)
  if (!status || state.phase === "unavailable" || status.availability === "unavailable")
    return {
      text: `Auto-switch: ${unknownLabel(state)}`,
      on: false,
      disabled: blocked,
      saving,
      notice,
    }
  const active = activeRoute(state)
  return {
    text: `Auto-switch: ${status.enabled ? "On" : "Off"}`,
    on: status.enabled,
    // A pending return is shown with the alternate it leaves, not twice.
    detail:
      state.pending?.kind === "switch"
        ? "Saving..."
        : active && status.reason === "return-pending"
          ? undefined
          : ReasonDetail[status.reason],
    disabled: blocked,
    saving,
    notice,
    autoReturn: autoReturnToggle(state),
    active,
  }
}

// How often the status is reread while it shows an alternate or a different next route, so a
// recovered allowance shows without a mutation. Reads use no inference.
const RecheckMs = 30_000

export function createAutoSwitch(input: {
  sessionID: Accessor<string | undefined>
  request: (sessionID: string, mutation?: AutoSwitchMutation) => Promise<AutoSwitchReply>
  every?: (run: () => void, ms: number) => () => void
}) {
  const [state, setState] = createStore<AutoSwitchState>({ phase: "loading" })
  let reads = 0

  createEffect(
    on(input.sessionID, () => {
      reads++
      setState({ phase: "loading", status: undefined, pending: undefined, notice: undefined, error: undefined })
      refresh()
    }),
  )

  function refresh() {
    const sessionID = input.sessionID()
    if (!sessionID) return
    const read = ++reads
    void send(sessionID).then((reply) => {
      if (read !== reads || sessionID !== input.sessionID()) return
      if (reply.type === "status" || reply.type === "conflict") return accept(sessionID, reply.status)
      if (reply.type === "unavailable") return setState({ phase: "unavailable", status: reply.status })
      if (reply.type === "unsupported" || reply.type === "invalid") return setState({ phase: reply.type, status: undefined })
      // A failed read leaves an acknowledged status in place; without one there is nothing to show.
      if (!state.status) setState({ phase: "error", error: reply.message })
    })
  }

  function send(sessionID: string, mutation?: AutoSwitchMutation) {
    return input
      .request(sessionID, mutation)
      .catch((error): AutoSwitchReply => ({ type: "unconfirmed", message: errorMessage(error) }))
  }

  // Applies an owner-acknowledged status unless one already shown is newer for the same owner,
  // which is how a read that started before a save cannot undo it.
  function accept(sessionID: string, status: AutoSwitchStatus) {
    if (status.sessionID !== sessionID) return setState({ phase: "invalid", status: undefined })
    const current = state.status
    if (
      current &&
      current.ownerEpoch === status.ownerEpoch &&
      current.revision !== null &&
      status.revision !== null &&
      status.revision < current.revision
    )
      return
    const notice = state.notice
    setState({
      phase: "ready",
      status,
      error: undefined,
      notice:
        notice && notice.key !== statusKey(status)
          ? undefined
          : notice?.kind === "unconfirmed"
            ? { kind: "failed", text: "Not saved", key: notice.key }
            : notice,
    })
  }

  function mutate(pending: Pending, build: (owner: { ownerEpoch: string; revision: number }) => AutoSwitchMutation) {
    const sessionID = input.sessionID()
    const refusal = blockedReason(state) ?? refusePending(pending)
    if (refusal || !sessionID) return refusal ?? "Open a session to use auto-switch"
    const status = state.status!
    const key = statusKey(status)
    setState({ pending, notice: undefined })
    void send(sessionID, build({ ownerEpoch: status.ownerEpoch!, revision: status.revision! })).then((reply) => {
      if (sessionID !== input.sessionID()) return
      setState("pending", undefined)
      // A save outlives a read that started before it.
      reads++
      if (reply.type === "status") return accept(sessionID, reply.status)
      if (reply.type === "conflict") {
        accept(sessionID, reply.status)
        return setState("notice", { kind: "stale", text: "Not saved: changed elsewhere", key: statusKey(reply.status) })
      }
      if (reply.type === "unavailable")
        return setState({
          phase: "unavailable",
          status: reply.status,
          notice: { kind: "failed", text: "Not saved: owner unavailable", key },
        })
      if (reply.type === "unsupported")
        return setState({
          phase: "unsupported",
          status: undefined,
          notice: { kind: "failed", text: "Not saved: older engine", key },
        })
      if (reply.type === "rejected")
        return setState("notice", { kind: "failed", text: `Not saved (${reply.message})`, key })
      setState("notice", {
        kind: "unconfirmed",
        text: reply.type === "invalid" ? "Save unconfirmed" : `Save unconfirmed (${reply.message})`,
        key,
      })
      refresh()
    })
  }

  function refusePending(pending: Pending) {
    const status = state.status!
    if (pending.kind === "return") {
      if (status.returnPending || autoReturn(status)?.returnState === "returning")
        return "Return to preferred is already pending"
      if (!status.effective || !status.preferred || sameRoute(status.effective, status.preferred))
        return "Already using the preferred route"
      return
    }
    if (pending.kind === "switch" && pending.preference === "inherit" && status.preference === "inherit")
      return "Auto-switch already follows the default"
    if (pending.kind !== "auto-return") return
    const automatic = autoReturn(status)
    if (!automatic) return "Auto-return needs a newer engine owner"
    if (pending.preference === "inherit" && automatic.returnPreference === "inherit")
      return "Auto-return already follows the default"
  }

  function setPreference(kind: "switch" | "auto-return", preference: AutoSwitchPreference) {
    return mutate({ kind, preference }, (owner) => ({
      action: kind === "switch" ? "set-preference" : "set-return-preference",
      preference,
      ...owner,
    }))
  }

  const view = createMemo(() => describeAutoSwitch(state))
  const every =
    input.every ??
    ((run: () => void, ms: number) => {
      const timer = setInterval(run, ms)
      return () => clearInterval(timer)
    })
  const showsRoute = createMemo(() => view().active !== undefined)
  createEffect(() => {
    if (!showsRoute()) return
    onCleanup(every(() => state.pending === undefined && refresh(), RecheckMs))
  })

  return {
    state,
    view,
    refresh,
    // An explicit toggle always records a session choice, which wins over a rule or the default.
    toggle: () => setPreference("switch", state.status?.enabled ? "off" : "on"),
    useDefault: () => setPreference("switch", "inherit"),
    toggleAutoReturn: () => setPreference("auto-return", state.status?.returnEnabled ? "off" : "on"),
    useAutoReturnDefault: () => setPreference("auto-return", "inherit"),
    returnToPreferred: () => mutate({ kind: "return" }, (owner) => ({ action: "return-to-preferred", ...owner })),
  }
}

const ReasonDetail: Record<AutoSwitchReason, string | undefined> = {
  "session-on": undefined,
  "session-off": undefined,
  "rule-on": "by rule",
  "rule-off": "by rule",
  "default-on": "default",
  "default-off": "default",
  pinned: "pinned",
  "older-engine": "older engine",
  "owner-unavailable": "owner unavailable",
  "no-approved-alternate": "no approved alternate",
  "route-ineligible": "route ineligible",
  "unsafe-step": "unsafe step",
  "stale-evidence": "stale evidence",
  attempted: "already attempted",
  "alternate-active": undefined,
  "return-pending": "returning at next step",
  "global-disabled": "disabled globally",
  "policy-unavailable": "policy unavailable",
  busy: "busy",
}

const unsupported = "Auto-switch needs a newer engine"
const ownerUnavailable = "The session's engine owner is unavailable"

function blockedReason(state: AutoSwitchState) {
  if (state.phase === "loading") return "Auto-switch status is still loading"
  if (state.phase === "unsupported") return unsupported
  if (state.phase === "invalid") return "Auto-switch status is unreadable"
  if (state.phase === "error") return `Auto-switch status is unavailable (${state.error})`
  const status = state.status
  if (state.phase === "unavailable" || !status || status.availability === "unavailable") return ownerUnavailable
  if (status.reason === "older-engine") return unsupported
  if (status.reason === "owner-unavailable" || status.ownerEpoch === null || status.revision === null)
    return ownerUnavailable
  if (status.reason === "pinned") return "This session's route is pinned"
  if (state.pending) return "Auto-switch is saving"
}

function unknownLabel(state: AutoSwitchState) {
  if (state.phase === "loading") return "..."
  if (state.phase === "unsupported") return "unsupported"
  if (state.phase === "unavailable" || state.status) return "unavailable"
  return "unknown"
}

// The automatic-return fields, only when the owner sent all of them; a partial set counts as none.
function autoReturn(status: AutoSwitchStatus) {
  if (
    status.returnPreference === undefined ||
    status.returnEnabled === undefined ||
    status.returnState === undefined ||
    status.next === undefined
  )
    return
  return {
    returnPreference: status.returnPreference,
    returnEnabled: status.returnEnabled,
    returnState: status.returnState,
    next: status.next,
  }
}

function autoReturnToggle(state: AutoSwitchState): Toggle | undefined {
  const automatic = state.status && autoReturn(state.status)
  if (!automatic) return
  return {
    text: `Auto-return: ${automatic.returnEnabled ? "On" : "Off"}`,
    on: automatic.returnEnabled,
    detail:
      state.pending?.kind === "auto-return"
        ? "Saving..."
        : automatic.returnPreference === "inherit"
          ? "default"
          : undefined,
  }
}

function activeRoute(state: AutoSwitchState): AutoSwitchView["active"] {
  const status = state.status
  if (!status?.preferred) return
  const automatic = autoReturn(status)
  const current = status.effective ?? status.preferred
  const alternate = !sameRoute(current, status.preferred)
  // Leaving an alternate for the preferred route is a return, shown as one rather than as a next route.
  const back = alternate && !!automatic?.next && sameRoute(automatic.next, status.preferred)
  const next = automatic?.next && !back && !sameRoute(automatic.next, current) ? automatic.next : undefined
  if (!alternate && !next) return
  const returning =
    back || status.returnPending || automatic?.returnState === "returning" || state.pending?.kind === "return"
  return {
    using: alternate ? routeLabel(current, status.preferred) : undefined,
    preferred: routeLabel(status.preferred, current),
    next: next ? routeLabel(next, status.preferred) : undefined,
    ...(automatic?.next && automatic.returnState !== "preferred" && {
      planned: routeLabel(automatic.next, status.preferred),
    }),
    context: automatic?.returnState === "returning" ? "returning: Claude has allowance"
      : automatic?.returnState === "return-off" ? `preferred: ${routeLabel(status.preferred, current)} (return off)`
      : automatic?.returnState === "alternate" ? `auto-switched from ${routeLabel(status.preferred, current)} (Claude spent)`
      : undefined,
    returning,
    canReturn: alternate && !returning && blockedReason(state) === undefined,
  }
}

// Names the agent only where the two routes run different agents.
function routeLabel(route: AutoSwitchRoute, other: AutoSwitchRoute) {
  return [route.agent === other.agent ? undefined : Locale.titlecase(route.agent), route.modelID, route.variant]
    .filter(Boolean)
    .join(" ")
}

function sameRoute(a: AutoSwitchRoute, b: AutoSwitchRoute) {
  return a.agent === b.agent && a.providerID === b.providerID && a.modelID === b.modelID && a.variant === b.variant
}

function statusKey(status: AutoSwitchStatus) {
  return `${status.ownerEpoch}:${status.revision}`
}

function bodyMessage(body: unknown) {
  if (!isRecord(body)) return
  if (isRecord(body.data) && typeof body.data.message === "string") return body.data.message
  if (typeof body.message === "string") return body.message
}
