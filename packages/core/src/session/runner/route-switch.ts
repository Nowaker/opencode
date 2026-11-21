import { and, eq, or } from "drizzle-orm"
import { Clock, Effect } from "effect"
import type { RouteSwitch } from "@opencode/schema/route-switch"
import { Database } from "../../database/database.js"
import { Model } from "../../model.js"
import { LocationLifecycle } from "../../location-lifecycle.js"
import type { MeridianRouting } from "../../plugin/provider/meridian-routing.js"
import type { SessionContext } from "../context.js"
import { SessionInputRevision } from "../input-revision.js"
import { SessionRecovery } from "../recovery.js"
import type { SessionMessage } from "../message.js"
import { SessionRouteSwitch } from "../route-switch.js"
import { SessionRouteSwitchState } from "../route-switch-state.js"
import { exactRoute, sameRoute } from "../route-switch-policy.js"
import type { SessionRunCoordinator } from "../run-coordinator.js"
import type { SessionSchema } from "../schema.js"
import { SessionInboxTable } from "../sql.js"
import { SessionStore } from "../store.js"

const RETURN_DWELL = 60_000
const RETURN_COOLDOWN = 5 * 60_000
type Owner = SessionRunCoordinator.Owner
type Attempt = SessionRouteSwitchState.Attempt
type Admission = { readonly id: SessionMessage.ID; readonly type: "user" | "synthetic"; readonly enqueuedSeq: number }

export const make = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const routes = yield* SessionRouteSwitch.Service
  const store = yield* SessionStore.Service
  const registry = yield* Model.Service
  const lifecycle = yield* LocationLifecycle.Service
  const transaction = <A>(effect: Effect.Effect<A>) => SessionRouteSwitchState.transaction(db, effect)
  const catalog = () =>
    registry.available().pipe(
      Effect.map((items) =>
        items.map((item) => ({
          providerID: item.providerID,
          modelID: item.id,
          variants: item.variants.map((variant) => variant.id),
        })),
      ),
    )

  const recover = (session: SessionSchema.Info, owner: Owner) =>
    transaction(
      Effect.gen(function* () {
        const state = yield* routes.read(session)
        if (state.owner !== owner.id || !owner.current()) return false
        if (state.manualRetry?.state === "claimed") {
          const current = yield* SessionInputRevision.read(db, session.id)
          yield* SessionRouteSwitchState.write(db, session.id, {
            ...state,
            manualRetry: undefined,
            reason: "unsafe-step",
            recoveryBlockedThrough: current?.seq ?? 0,
            revision: state.revision + 1,
          })
          return false
        }
        if (state.manualRetry && state.manualRetry.epoch !== SessionRouteSwitch.ownerEpoch)
          yield* SessionRouteSwitchState.write(db, session.id, {
            ...state,
            manualRetry: undefined,
            revision: state.revision + 1,
          })
        if (state.turn?.owner !== owner.id && (state.turn?.alternate || state.turn?.returned)) {
          const current = yield* SessionInputRevision.read(db, session.id)
          yield* SessionRouteSwitchState.write(db, session.id, {
            ...state,
            turn: undefined,
            reason: "unsafe-step",
            recoveryBlockedThrough: current?.seq ?? 0,
            revision: state.revision + 1,
          })
          return false
        }
        return (
          state.recoveryBlockedThrough === undefined ||
          (yield* freshPendingInput(session.id, state.recoveryBlockedThrough))
        )
      }),
    )

  const freshPendingInput = (sessionID: SessionSchema.ID, blockedThrough: number) =>
    db
      .select({ seq: SessionInboxTable.enqueued_seq })
      .from(SessionInboxTable)
      .where(and(eq(SessionInboxTable.session_id, sessionID), eq(SessionInboxTable.type, "user")))
      .all()
      .pipe(
        Effect.orDie,
        Effect.map((rows) => rows.some((row) => row.seq > blockedThrough)),
      )

  const begin = (session: SessionSchema.Info, owner: Owner, promoted: readonly Admission[]) =>
    transaction(
      Effect.gen(function* () {
        const state = yield* routes.read(session)
        if (state.owner !== owner.id || !owner.current()) return false
        const real = promoted.filter((item) => item.type === "user").at(-1)
        if (state.recoveryBlockedThrough !== undefined && (!real || real.enqueuedSeq <= state.recoveryBlockedThrough))
          return false
        if (!real) return true
        const current = state.turn?.owner === owner.id ? state.turn : undefined
        const afterSettlement =
          !current &&
          state.settledThrough !== undefined &&
          promoted.every((item) => item.type === "user" && item.enqueuedSeq > (state.settledThrough ?? 0))
        yield* SessionRouteSwitchState.write(db, session.id, {
          ...state,
          manualRetry: undefined,
          recoveryBlockedThrough: undefined,
          turn: current
            ? { ...current, inputID: real.id }
            : { id: real.id, inputID: real.id, owner: owner.id, afterSettlement },
        })
        return true
      }),
    )

  const observe = Effect.fnUntraced(function* (loaded: SessionContext.Loaded, owner: Owner) {
    const preferred = exactRoute(loaded.agent.id, loaded.model.ref)
    const revision = yield* SessionInputRevision.read(db, loaded.session.id)
    const models = yield* catalog()
    const state = yield* transaction(
      Effect.gen(function* () {
        const state = yield* routes.read(loaded.session)
        if (!sameRoute(state.preferred, preferred) && state.owner === owner.id && owner.current()) {
          const next = {
            ...state,
            preferred,
            sticky: undefined,
            manualReturn: false,
            quotaStop: undefined,
            reason: undefined,
            revision: state.revision + 1,
          }
          yield* SessionRouteSwitchState.write(db, loaded.session.id, next)
          return next
        }
        return state
      }),
    )
    const policy = routes.evaluate(loaded.session, state, preferred, models)
    const latestUser = loaded.messages.findLast((message) => message.type === "user")
    return {
      session: loaded.session,
      owner,
      preferred,
      state,
      policy,
      revision,
      turn: state.turn?.owner === owner.id && state.turn.inputID === latestUser?.id ? state.turn : undefined,
    }
  })

  type Fence = Effect.Success<ReturnType<typeof observe>>
  const authorized = (fence: Fence, target: RouteSwitch.Route, kind: Attempt["kind"] | "sticky") =>
    Effect.gen(function* () {
      const current = yield* store.get(fence.session.id)
      if (!current || !sameSelection(current, fence.session) || lifecycle.isClosed()) return
      const state = yield* routes.read(current)
      if (state.owner !== fence.owner.id || !fence.owner.current() || state.revision !== fence.state.revision) return
      const input = yield* SessionInputRevision.read(db, current.id)
      if (!input || !SessionInputRevision.matches(input, fence.revision)) return
      const pending = yield* db
        .select({ id: SessionInboxTable.id })
        .from(SessionInboxTable)
        .where(
          and(
            eq(SessionInboxTable.session_id, current.id),
            or(
              eq(SessionInboxTable.delivery, "steer"),
              eq(SessionInboxTable.type, "move"),
              eq(SessionInboxTable.type, "compaction"),
            ),
          ),
        )
        .limit(1)
        .get()
        .pipe(Effect.orDie)
      if (pending) return
      const policy = routes.evaluate(current, state, fence.preferred, yield* catalog())
      if (!policy.enabled || policy.policyRevision !== fence.policy.policyRevision) return
      if (kind === "return") {
        if (!policy.returnEnabled || !state.sticky || !sameRoute(state.sticky.preferred, target)) return
      } else if (!policy.alternates.some((candidate) => sameRoute(candidate, target))) return
      if (!fence.owner.current() || lifecycle.isClosed()) return
      return state
    })

  const validateSticky = (fence: Fence, target: RouteSwitch.Route) =>
    transaction(authorized(fence, target, "sticky")).pipe(Effect.map(Boolean))

  const claim = (fence: Fence, attempt: Omit<Attempt, "at" | "outcome" | "owner" | "inputID">) =>
    transaction(
      Effect.gen(function* () {
        const state = yield* authorized(fence, attempt.target, attempt.kind)
        const turn = state?.turn
        if (!state || !turn || !fence.turn || turn.id !== fence.turn.id || turn.inputID !== fence.turn.inputID)
          return false
        const at = yield* Clock.currentTimeMillis
        if (attempt.kind === "return" ? !returnDue(state, at) : turn.alternate !== undefined) return false
        if (!fence.owner.current() || lifecycle.isClosed()) return false
        const record = { ...attempt, at, owner: fence.owner.id, inputID: turn.inputID, outcome: "claimed" as const }
        yield* SessionRouteSwitchState.write(db, fence.session.id, {
          ...state,
          revision: state.revision + 1,
          quotaStop: undefined,
          turn: attempt.kind === "return" ? { ...turn, returned: record } : { ...turn, alternate: record },
        })
        return true
      }),
    )

  const finish = (fence: Fence, id: SessionMessage.ID, outcome: Exclude<Attempt["outcome"], "claimed">) =>
    transaction(
      Effect.gen(function* () {
        const state = yield* routes.read(fence.session)
        const turn = state.turn
        if (!turn || state.owner !== fence.owner.id) return false
        const attempt = [turn.alternate, turn.returned].find((candidate) => candidate?.targetAttemptID === id)
        if (!attempt || attempt.outcome !== "claimed") return false
        const done = { ...attempt, outcome }
        const now = yield* Clock.currentTimeMillis
        yield* SessionRouteSwitchState.write(db, fence.session.id, {
          ...state,
          turn: attempt.kind === "return" ? { ...turn, returned: done } : { ...turn, alternate: done },
          lastAlternate: attempt.kind === "alternate" ? done : state.lastAlternate,
          lastReturn: attempt.kind === "return" ? done : state.lastReturn,
          sticky:
            outcome !== "succeeded"
              ? state.sticky
              : attempt.kind === "return"
                ? undefined
                : { preferred: fence.preferred, effective: attempt.target, since: state.sticky?.since ?? now },
          cooldownUntil:
            attempt.kind === "return" && outcome !== "succeeded" ? now + RETURN_COOLDOWN : state.cooldownUntil,
          awaitCleanTurn: (attempt.kind === "return" && outcome !== "succeeded") || state.awaitCleanTurn,
          quotaStop: outcome === "succeeded" ? undefined : state.quotaStop,
          reason: outcome === "succeeded" ? undefined : state.reason,
          revision: state.revision + 1,
        })
        return true
      }),
    ).pipe(Effect.flatMap((changed) => (changed ? routes.updated(fence.session.id) : Effect.void)))

  const settle = (session: SessionSchema.Info, owner: Owner, clean: boolean) =>
    transaction(
      Effect.gen(function* () {
        const state = yield* routes.read(session)
        if (state.owner !== owner.id || state.turn?.owner !== owner.id) return
        const revision = yield* SessionInputRevision.read(db, session.id)
        const unknown = [state.turn.alternate, state.turn.returned].some(
          (attempt) => attempt?.outcome === "claimed" || attempt?.outcome === "unknown",
        )
        yield* SessionRouteSwitchState.write(db, session.id, {
          ...state,
          turn: undefined,
          settledThrough: clean ? revision?.seq : undefined,
          recoveryBlockedThrough: unknown ? (revision?.seq ?? 0) : state.recoveryBlockedThrough,
          awaitCleanTurn: clean && !state.turn.returned ? false : state.awaitCleanTurn,
        })
      }),
    )

  const closeReturnWindow = (session: SessionSchema.Info, owner: Owner) =>
    transaction(
      Effect.gen(function* () {
        const state = yield* routes.read(session)
        if (state.owner !== owner.id || state.turn?.owner !== owner.id || !state.turn.afterSettlement) return
        yield* SessionRouteSwitchState.write(db, session.id, {
          ...state,
          turn: { ...state.turn, afterSettlement: false },
        })
      }),
    )

  const recordStop = (
    fence: Fence,
    stopped: { readonly route: RouteSwitch.Route; readonly assistantID: SessionMessage.ID; readonly step: number },
    refusal: MeridianRouting.Refusal,
    reason: RouteSwitch.Reason,
  ) =>
    transaction(
      Effect.gen(function* () {
        const state = yield* routes.read(fence.session)
        if (state.owner !== fence.owner.id) return
        yield* SessionRouteSwitchState.write(db, fence.session.id, {
          ...state,
          reason,
          quotaStop: { ...stopped, reason: refusal.reason },
          revision: state.revision + 1,
        })
      }),
    ).pipe(Effect.andThen(routes.updated(fence.session.id)))

  const clearStop = (fence: Fence, route: RouteSwitch.Route) =>
    transaction(
      Effect.gen(function* () {
        const state = yield* routes.read(fence.session)
        if (state.owner !== fence.owner.id || !sameRoute(state.quotaStop?.route, route)) return false
        yield* SessionRouteSwitchState.write(db, fence.session.id, {
          ...state,
          quotaStop: undefined,
          reason: undefined,
          revision: state.revision + 1,
        })
        return true
      }),
    ).pipe(Effect.flatMap((changed) => (changed ? routes.updated(fence.session.id) : Effect.void)))

  const claimManual = (fence: Fence, target: RouteSwitch.Route) =>
    transaction(
      Effect.gen(function* () {
        const current = yield* store.get(fence.session.id)
        if (!current || !sameSelection(current, fence.session) || lifecycle.isClosed() || !fence.owner.current())
          return false
        const state = yield* routes.read(current)
        const retry = state.manualRetry
        const stop = state.quotaStop
        if (
          !retry ||
          retry.id !== fence.owner.retry ||
          retry.state !== "requested" ||
          retry.epoch !== SessionRouteSwitch.ownerEpoch ||
          retry.revision !== state.revision ||
          state.owner !== fence.owner.id ||
          !stop ||
          !sameRoute(stop.route, target)
        )
          return false
        const policy = routes.evaluate(current, state, fence.preferred, yield* catalog())
        if (
          policy.policyRevision !== fence.policy.policyRevision ||
          (!sameRoute(target, fence.preferred) &&
            (!policy.enabled || !policy.alternates.some((route) => sameRoute(route, target))))
        )
          return false
        const recovery = yield* SessionRecovery.read(db, current.id).pipe(Effect.orDie)
        if (
          recovery.pendingInput ||
          recovery.stagedRevert ||
          recovery.assistantMessageID !== stop.assistantID ||
          !SessionInputRevision.matches(recovery.inputRevision, retry.inputRevision) ||
          !fence.owner.current()
        )
          return false
        yield* SessionRouteSwitchState.write(db, current.id, { ...state, manualRetry: { ...retry, state: "claimed" } })
        return true
      }),
    )

  const finishManual = (fence: Fence, proved: boolean) =>
    transaction(
      Effect.gen(function* () {
        const state = yield* routes.read(fence.session)
        if (state.owner !== fence.owner.id || !state.manualRetry || state.manualRetry.id !== fence.owner.retry) return
        const current = yield* SessionInputRevision.read(db, fence.session.id)
        yield* SessionRouteSwitchState.write(db, fence.session.id, {
          ...state,
          manualRetry: undefined,
          recoveryBlockedThrough:
            !proved && state.manualRetry.state === "claimed" ? (current?.seq ?? 0) : state.recoveryBlockedThrough,
          revision: state.revision + 1,
        })
      }),
    ).pipe(Effect.andThen(routes.updated(fence.session.id)))

  const resetSticky = (fence: Fence) =>
    transaction(
      Effect.gen(function* () {
        const state = yield* routes.read(fence.session)
        if (state.owner !== fence.owner.id || !fence.owner.current() || state.revision !== fence.state.revision)
          return false
        yield* SessionRouteSwitchState.write(db, fence.session.id, {
          ...state,
          sticky: undefined,
          manualReturn: false,
          reason: undefined,
          revision: state.revision + 1,
        })
        return true
      }),
    )

  return {
    recover,
    begin,
    observe,
    validateSticky,
    claim,
    finish,
    settle,
    closeReturnWindow,
    recordStop,
    clearStop,
    claimManual,
    finishManual,
    resetSticky,
    updated: routes.updated,
  }
})

export function returnDue(state: SessionRouteSwitchState.State, now: number) {
  return (
    state.turn?.afterSettlement === true && !state.turn.returned && !state.turn.alternate && returnReady(state, now)
  )
}

export function returnReady(state: SessionRouteSwitchState.State, now: number) {
  return (
    state.sticky !== undefined &&
    now >= state.sticky.since + RETURN_DWELL &&
    now >= (state.cooldownUntil ?? 0) &&
    state.awaitCleanTurn !== true
  )
}

export function sameSelection(a: SessionSchema.Info, b: SessionSchema.Info) {
  return (
    a.agent === b.agent &&
    a.model?.providerID === b.model?.providerID &&
    a.model?.id === b.model?.id &&
    a.model?.variant === b.model?.variant &&
    a.title === b.title &&
    a.parentID === b.parentID &&
    a.location.directory === b.location.directory &&
    a.location.workspaceID === b.location.workspaceID &&
    a.time.archived === undefined &&
    JSON.stringify(a.permissions) === JSON.stringify(b.permissions)
  )
}
