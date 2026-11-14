import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "./schema"
import { Effect, Layer, Context } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionStatusEvent } from "@opencode-ai/schema/session-status-event"
import { SessionPauseEvent } from "@opencode-ai/schema/session-pause-event"

export const Info = SessionStatusEvent.Info
export type Info = SessionStatusEvent.Info

export const Event = SessionStatusEvent

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<Map<SessionID, Info>>
  readonly set: (sessionID: SessionID, status: Info) => Effect.Effect<void>
  /** Attaches a session's pause to every status it reports, an idle one included, and republishes it. */
  readonly setPaused: (sessionID: SessionID, pause: SessionPauseEvent.Info | undefined) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionStatus") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionStatus.state")(() =>
        Effect.succeed({
          statuses: new Map<SessionID, Info>(),
          paused: new Map<SessionID, SessionPauseEvent.Info>(),
        }),
      ),
    )

    const withPause = (status: Info, pause: SessionPauseEvent.Info | undefined): Info => {
      const { paused: _, ...rest } = status
      return pause ? { ...rest, paused: pause } : rest
    }

    const get = Effect.fn("SessionStatus.get")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      return withPause(data.statuses.get(sessionID) ?? { type: "idle" as const }, data.paused.get(sessionID))
    })

    const list = Effect.fn("SessionStatus.list")(function* () {
      const data = yield* InstanceState.get(state)
      const ids = new Set([...data.statuses.keys(), ...data.paused.keys()])
      return new Map(
        [...ids].map((id) => [id, withPause(data.statuses.get(id) ?? { type: "idle" as const }, data.paused.get(id))]),
      )
    })

    const set = Effect.fn("SessionStatus.set")(function* (sessionID: SessionID, status: Info) {
      const data = yield* InstanceState.get(state)
      yield* events.publish(Event.Status, { sessionID, status: withPause(status, data.paused.get(sessionID)) })
      if (status.type === "idle") {
        yield* events.publish(Event.Idle, { sessionID })
        data.statuses.delete(sessionID)
        return
      }
      data.statuses.set(sessionID, withPause(status, undefined))
    })

    const setPaused = Effect.fn("SessionStatus.setPaused")(function* (
      sessionID: SessionID,
      pause: SessionPauseEvent.Info | undefined,
    ) {
      const data = yield* InstanceState.get(state)
      if (pause) data.paused.set(sessionID, pause)
      else data.paused.delete(sessionID)
      yield* events.publish(Event.Status, {
        sessionID,
        status: withPause(data.statuses.get(sessionID) ?? { type: "idle" }, pause),
      })
    })

    return Service.of({ get, list, set, setPaused })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2Bridge.node] })

export * as SessionStatus from "./status"
