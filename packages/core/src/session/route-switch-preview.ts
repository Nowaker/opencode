export * as SessionRouteSwitchPreview from "./route-switch-preview.js"

import { Clock, Context, Effect, Layer, Option } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Database } from "../database/database.js"
import { KeyedMutex } from "../effect/keyed-mutex.js"
import { Instance } from "../instance/service.js"
import { MeridianRouting } from "../plugin/provider/meridian-routing.js"
import { SessionContext } from "./context.js"
import { NotFoundError } from "./error.js"
import { SessionExecution } from "./execution.js"
import { SessionInputRevision } from "./input-revision.js"
import { SessionRecovery } from "./recovery.js"
import { SessionRouteSwitch } from "./route-switch.js"
import { exactRoute, sameRoute } from "./route-switch-policy.js"
import { SessionRouteSwitchState } from "./route-switch-state.js"
import { returnReady, sameSelection } from "./runner/route-switch.js"
import { prepare } from "./runner/route-transcript.js"
import type { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()(
  "@opencode/SessionRouteSwitchPreview",
) {}

const make = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const routes = yield* SessionRouteSwitch.Service
  const execution = yield* SessionExecution.Service
  const store = yield* SessionStore.Service
  const instances = yield* Instance.Service
  const locks = KeyedMutex.makeUnsafe<SessionSchema.ID>()

  const idle = (sessionID: SessionSchema.ID) =>
    SessionRouteSwitchState.transaction(
      db,
      Effect.gen(function* () {
        const session = yield* store.get(sessionID)
        if (!session) return yield* new NotFoundError({ sessionID })
        if (session.time.archived !== undefined || execution.identity(sessionID) !== null) return
        const state = yield* routes.read(session)
        const at = yield* Clock.currentTimeMillis
        if (!state.sticky || state.turn || state.settledThrough === undefined || !returnReady(state, at)) return
        const preferred = state.sticky.preferred
        const selected = session.model && session.agent ? exactRoute(session.agent, session.model) : state.preferred
        if (!sameRoute(selected, preferred)) return
        const recovery = yield* SessionRecovery.read(db, sessionID)
        if (
          recovery.pendingInput ||
          recovery.stagedRevert ||
          recovery.executionClaim !== null ||
          execution.identity(sessionID) !== null
        )
          return
        const policy = routes.evaluate(session, state, preferred)
        if (!policy.enabled || !policy.returnEnabled) return
        return { session, preferred, recovery, state, policy, at }
      }),
    )

  const refresh = Effect.fn("SessionRouteSwitchPreview.refresh")(function* (sessionID: SessionSchema.ID) {
    yield* locks.withLock(sessionID)(
      Effect.gen(function* () {
        const before = yield* idle(sessionID)
        if (!before) return
        const cached = routes.preview.get(sessionID)
        if (
          cached &&
          cached.expiresAt > before.at &&
          cached.revision === before.state.revision &&
          cached.policyRevision === before.policy.policyRevision &&
          sameRoute(cached.preferred, before.preferred) &&
          SessionInputRevision.matches(cached.inputRevision, before.recovery.inputRevision)
        )
          return
        const proof = yield* Effect.gen(function* () {
          const context = yield* SessionContext.Service
          const selected = yield* context.select(sessionID)
          const loaded = yield* context.loadRoute(selected, before.preferred)
          if (!loaded) return
          const prepared = yield* prepare({ context, loaded, step: 1, portable: true, http: true })
          if (!prepared) return
          const verified = yield* idle(sessionID)
          if (
            !verified ||
            !sameSelection(before.session, verified.session) ||
            before.state.revision !== verified.state.revision ||
            before.policy.policyRevision !== verified.policy.policyRevision ||
            !SessionInputRevision.matches(before.recovery.inputRevision, verified.recovery.inputRevision)
          )
            return
          return yield* MeridianRouting.probe({ ...prepared, selection: before.preferred })
        }).pipe(
          instances.provide(before.session),
          Effect.timeoutOption("2 seconds"),
          Effect.orElseSucceed(() => undefined),
        )
        const after = yield* idle(sessionID)
        if (
          !after ||
          !sameSelection(before.session, after.session) ||
          after.state.revision !== before.state.revision ||
          after.policy.policyRevision !== before.policy.policyRevision ||
          !sameRoute(after.preferred, before.preferred) ||
          !SessionInputRevision.matches(after.recovery.inputRevision, before.recovery.inputRevision)
        )
          return
        const proved = proof === undefined ? undefined : Option.getOrUndefined(proof)
        routes.preview.set(sessionID, {
          revision: after.state.revision,
          preferred: after.preferred,
          policyRevision: after.policy.policyRevision,
          inputRevision: after.recovery.inputRevision,
          expiresAt: proved?.validUntil ?? after.at + 5_000,
          ready: proved !== undefined,
        })
      }),
    )
    return yield* routes.status(sessionID)
  })
  return { refresh }
})

const layer = Layer.effect(Service, make)
export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, SessionExecution.node, SessionStore.node, SessionRouteSwitch.node, Instance.node],
})
