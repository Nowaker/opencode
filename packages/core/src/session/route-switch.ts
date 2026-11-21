export * as SessionRouteSwitch from "./route-switch.js"

import { Clock, Context, Effect, Layer } from "effect"
import { RouteSwitch } from "@opencode/schema/route-switch"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { EngineStop } from "../engine-stop.js"
import { NotFoundError } from "./error.js"
import { SessionEvent } from "./event.js"
import { SessionStore } from "./store.js"
import type { SessionSchema } from "./schema.js"
import { SessionRouteSwitchState } from "./route-switch-state.js"
import { exactRoute, load, sameRoute } from "./route-switch-policy.js"
import { SessionRecovery } from "./recovery.js"
import { SessionInputRevision } from "./input-revision.js"

export interface Preview {
  readonly revision: number
  readonly policyRevision: string
  readonly preferred: RouteSwitch.Route
  readonly inputRevision: SessionSchema.InputRevision | null
  readonly expiresAt: number
  readonly ready: boolean
}

export const ownerEpoch = crypto.randomUUID()

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@opencode/SessionRouteSwitch") {}

const make = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const store = yield* SessionStore.Service
  const bus = yield* Bus.Service
  const engine = yield* EngineStop.Service
  const evaluate = yield* load
  const previews = new Map<SessionSchema.ID, Preview>()
  const getSession = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
    const session = yield* store.get(sessionID)
    if (!session) return yield* new NotFoundError({ sessionID })
    return session
  })
  const read = (session: SessionSchema.Info) => SessionRouteSwitchState.read(db, session.id, session.parentID != null)
  const updated = (sessionID: SessionSchema.ID) =>
    bus.publish(SessionEvent.RouteSwitchUpdated, { sessionID }).pipe(Effect.asVoid)
  const project = (
    session: SessionSchema.Info,
    state: SessionRouteSwitchState.State,
    previewExpiresAt?: number,
  ): RouteSwitch.Status => {
    const preferred =
      session.model && session.agent ? exactRoute(session.agent, session.model) : (state.preferred ?? null)
    const policy = evaluate(session, state, preferred)
    const active = [state.turn?.alternate, state.turn?.returned].find((attempt) => attempt?.outcome === "claimed")
    const alternate = state.sticky && sameRoute(preferred, state.sticky.preferred) ? state.sticky.effective : null
    const returning = active?.kind === "return" || previewExpiresAt !== undefined
    const available = policy.reason !== "policy-unavailable"
    const status = {
      version: 1,
      sessionID: session.id,
      ownerEpoch,
      revision: state.revision,
      reason:
        policy.reason === "pinned" || policy.reason === "global-disabled"
          ? policy.reason
          : state.quotaStop
            ? (state.reason ?? "route-ineligible")
            : state.manualReturn || returning
              ? "return-pending"
              : alternate
                ? (state.reason ?? "alternate-active")
                : (state.reason ?? policy.reason),
      preference: state.preference,
      preferred,
      effective: active?.target ?? alternate ?? preferred,
      returnPending: state.manualReturn || active?.kind === "return",
      returnPreference: state.returnPreference,
      returnEnabled: available && policy.returnEnabled,
      returnState: returning
        ? "returning"
        : alternate
          ? policy.returnEnabled
            ? "alternate"
            : "return-off"
          : "preferred",
      next:
        active?.target ??
        (previewExpiresAt !== undefined
          ? preferred
          : alternate && (policy.returnEnabled || state.manualReturn)
            ? null
            : (alternate ?? preferred)),
      ...(previewExpiresAt === undefined ? {} : { previewExpiresAt }),
      ...(state.quotaStop ? { quotaStop: { route: state.quotaStop.route, reason: state.quotaStop.reason } } : {}),
    } satisfies Omit<RouteSwitch.Status, "available" | "availability" | "enabled">
    return available
      ? { ...status, availability: "available", enabled: policy.enabled }
      : { ...status, availability: "unavailable", enabled: false, reason: "policy-unavailable", next: null }
  }
  const status = Effect.fn("SessionRouteSwitch.status")(function* (sessionID: SessionSchema.ID) {
    return yield* SessionRouteSwitchState.transaction(
      db,
      Effect.gen(function* () {
        const session = yield* getSession(sessionID)
        const state = yield* read(session)
        const preview = previews.get(sessionID)
        if (
          preview?.ready &&
          preview.revision === state.revision &&
          sameRoute(preview.preferred, state.sticky?.preferred) &&
          preview.expiresAt > (yield* Clock.currentTimeMillis)
        ) {
          const current = yield* SessionRecovery.read(db, sessionID)
          const policy = evaluate(session, state, preview.preferred)
          const selected = session.model && session.agent ? exactRoute(session.agent, session.model) : state.preferred
          if (
            !current.pendingInput &&
            current.executionClaim === null &&
            !current.stagedRevert &&
            sameRoute(selected, preview.preferred) &&
            policy.enabled &&
            policy.returnEnabled &&
            policy.policyRevision === preview.policyRevision &&
            SessionInputRevision.matches(current.inputRevision, preview.inputRevision)
          )
            return project(session, state, preview.expiresAt)
        }
        return project(session, state)
      }),
    )
  })
  const edit = Effect.fn("SessionRouteSwitch.edit")(function* (
    input: RouteSwitch.Mutation & { readonly sessionID: SessionSchema.ID },
  ) {
    const result: RouteSwitch.EditResult = yield* engine
      .within(
        SessionRouteSwitchState.transaction(
          db,
          Effect.gen(function* (): Effect.fn.Return<RouteSwitch.EditResult, NotFoundError> {
            const session = yield* getSession(input.sessionID)
            const state = yield* read(session)
            const current = project(session, state)
            if (current.availability === "unavailable") return { status: 503, data: current }
            if (current.reason === "pinned") return { status: 409, data: current }
            if (input.ownerEpoch !== ownerEpoch || input.revision !== state.revision)
              return { status: 409, data: current }
            if (input.action === "return-to-preferred" && !state.sticky) return { status: 409, data: current }
            const updated = {
              ...state,
              revision: state.revision + 1,
              reason: undefined,
              ...RouteSwitchMutation(input),
            }
            yield* SessionRouteSwitchState.write(db, session.id, updated)
            return { status: 200, data: project(session, updated) }
          }),
        ),
      )
      .pipe(
        Effect.catchTag("EngineStop.RefusedError", () =>
          status(input.sessionID).pipe(
            Effect.map(
              (data): RouteSwitch.EditResult => ({
                status: 503,
                data: { ...data, availability: "unavailable", enabled: false, reason: "owner-unavailable" },
              }),
            ),
          ),
        ),
      )
    if (result.status === 200) yield* updated(input.sessionID)
    return result
  })
  const preview = {
    get: (sessionID: SessionSchema.ID) => previews.get(sessionID),
    set: (sessionID: SessionSchema.ID, value: Preview) => {
      if (previews.size >= 128 && !previews.has(sessionID)) {
        const oldest = previews.keys().next().value
        if (oldest) previews.delete(oldest)
      }
      previews.set(sessionID, value)
    },
  }
  return { status, edit, read, evaluate, updated, preview, project }
})

function RouteSwitchMutation(input: RouteSwitch.Mutation): Partial<SessionRouteSwitchState.State> {
  switch (input.action) {
    case "set-preference":
      return { preference: input.preference }
    case "set-return-preference":
      return { returnPreference: input.preference }
    case "return-to-preferred":
      return { manualReturn: true }
    default:
      return input satisfies never
  }
}

const layer = Layer.effect(Service, make)
export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, SessionStore.node, Bus.node, EngineStop.node],
})
