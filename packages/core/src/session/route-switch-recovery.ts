export * as SessionRouteSwitchRecovery from "./route-switch-recovery.js"

import { Context, Effect, Layer } from "effect"
import type { RouteSwitch } from "@opencode/schema/route-switch"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Database } from "../database/database.js"
import { EngineStop } from "../engine-stop.js"
import { NotFoundError } from "./error.js"
import { SessionExecution } from "./execution.js"
import { SessionRecovery } from "./recovery.js"
import { SessionRouteSwitch } from "./route-switch.js"
import { SessionRouteSwitchState } from "./route-switch-state.js"
import { exactRoute, sameRoute } from "./route-switch-policy.js"
import type { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()(
  "@opencode/SessionRouteSwitchRecovery",
) {}

const make = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const engine = yield* EngineStop.Service
  const execution = yield* SessionExecution.Service
  const routes = yield* SessionRouteSwitch.Service
  const store = yield* SessionStore.Service

  const retry = Effect.fn("SessionRouteSwitchRecovery.retry")(function* (input: {
    readonly sessionID: SessionSchema.ID
    readonly ownerEpoch: string
    readonly revision: number
  }) {
    const id = crypto.randomUUID()
    const result = yield* engine
      .within(
        Effect.gen(function* () {
          const accepted = yield* SessionRouteSwitchState.transaction(
            db,
            Effect.gen(function* (): Effect.fn.Return<RouteSwitch.EditResult, NotFoundError> {
              const session = yield* store.get(input.sessionID)
              if (!session) return yield* new NotFoundError({ sessionID: input.sessionID })
              const state = yield* routes.read(session)
              const current = routes.project(session, state)
              if (current.availability === "unavailable" || !execution.resumeDetached)
                return { status: 503, data: current }
              if (
                input.ownerEpoch !== SessionRouteSwitch.ownerEpoch ||
                input.revision !== state.revision ||
                state.manualRetry ||
                !state.quotaStop ||
                state.recoveryBlockedThrough !== undefined ||
                session.time.archived !== undefined ||
                execution.identity(session.id) !== null
              )
                return { status: 409, data: current }
              const preferred =
                session.model && session.agent ? exactRoute(session.agent, session.model) : state.preferred
              if (
                !sameRoute(state.preferred, preferred) ||
                (!sameRoute(state.quotaStop.route, preferred) &&
                  !sameRoute(state.quotaStop.route, state.sticky?.effective))
              )
                return { status: 409, data: current }
              const recovery = yield* SessionRecovery.read(db, session.id)
              if (
                recovery.executionClaim !== null ||
                recovery.pendingInput ||
                recovery.stagedRevert ||
                recovery.assistantMessageID !== state.quotaStop.assistantID ||
                execution.identity(session.id) !== null
              )
                return { status: 409, data: current }
              const revision = state.revision + 1
              const updated = {
                ...state,
                revision,
                manualRetry: {
                  id,
                  epoch: SessionRouteSwitch.ownerEpoch,
                  revision,
                  inputRevision: recovery.inputRevision,
                  state: "requested" as const,
                },
              }
              yield* SessionRouteSwitchState.write(db, session.id, updated)
              return { status: 200, data: routes.project(session, updated) }
            }),
          )
          if (accepted.status !== 200) return accepted
          const started = execution.resumeDetached && (yield* execution.resumeDetached(input.sessionID, id))
          if (started) return accepted
          yield* SessionRouteSwitchState.transaction(
            db,
            Effect.gen(function* () {
              const session = yield* store.get(input.sessionID)
              if (!session) return
              const state = yield* routes.read(session)
              if (state.manualRetry?.id !== id) return
              yield* SessionRouteSwitchState.write(db, session.id, {
                ...state,
                manualRetry: undefined,
                revision: state.revision + 1,
              })
            }),
          )
          return { status: 409, data: yield* routes.status(input.sessionID) } satisfies RouteSwitch.EditResult
        }),
      )
      .pipe(
        Effect.catchTag("EngineStop.RefusedError", () =>
          routes
            .status(input.sessionID)
            .pipe(
              Effect.map(
                (data): RouteSwitch.EditResult => ({
                  status: 503,
                  data: { ...data, availability: "unavailable", enabled: false, reason: "owner-unavailable" },
                }),
              ),
            ),
        ),
      )
    if (result.status === 200) {
      yield* routes.updated(input.sessionID)
    }
    return result
  }, Effect.uninterruptible)
  return { retry }
})

const layer = Layer.effect(Service, make)
export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, EngineStop.node, SessionExecution.node, SessionRouteSwitch.node, SessionStore.node],
})
