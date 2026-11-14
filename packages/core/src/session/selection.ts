export * as SessionSelection from "./selection.js"

import { Effect } from "effect"
import { Agent } from "../agent.js"
import { LocationServiceMap } from "../location-service-map.js"
import { Model } from "../model.js"
import { ModelResolver } from "../model-resolver.js"
import { AgentNotFoundError, NotFoundError } from "./error.js"
import { SessionRunnerModel } from "./runner/model.js"
import { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"

export const make = Effect.gen(function* () {
  const store = yield* SessionStore.Service
  const locations = yield* LocationServiceMap.Service
  return Effect.fn("SessionSelection.read")(function* (input: { readonly sessionID: SessionSchema.ID }) {
    const session = yield* store.get(input.sessionID)
    if (!session) return yield* new NotFoundError({ sessionID: input.sessionID })
    return yield* Effect.gen(function* () {
      const agents = yield* Agent.Service
      const models = yield* Model.Service
      const agent = yield* agents.select(session.agent)
      if (!agent.info) return yield* new AgentNotFoundError({ sessionID: session.id, agent: agent.id })
      const select = yield* SessionRunnerModel.makeSelection
      const selected = yield* select(session, models.available)
      yield* ModelResolver.withVariant(selected.info, selected.variant)
      return SessionSchema.Selection.make({
        agent: agent.id,
        model: Model.Ref.make({
          providerID: selected.info.providerID,
          id: selected.info.id,
          ...(selected.variant === undefined ? {} : { variant: selected.variant }),
        }),
      })
    }).pipe(Effect.provide(locations.get(session.location)))
  })
})
