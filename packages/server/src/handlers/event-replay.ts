import { Bus } from "@opencode/core/bus"
import { ConflictError, InvalidRequestError } from "@opencode/protocol/errors"
import type { EventReplayPayload } from "@opencode/protocol/groups/event"
import { Durable } from "@opencode/schema/durable-event-manifest"
import { SessionLegacy } from "@opencode/schema/session-legacy"
import { Effect, Schema } from "effect"
import { HttpApiSchema } from "effect/http-api"

export const makeEventReplay = Effect.gen(function* () {
  const bus = yield* Bus.Service
  return (payload: EventReplayPayload) =>
    Effect.gen(function* () {
      const event = payload.event
      const definition = Durable.get(event.type)
      if (!definition)
        return yield* new InvalidRequestError({
          message: `Unknown durable event type ${event.type}`,
          field: "event.type",
        })
      yield* Schema.decodeUnknownEffect(definition.data)(SessionLegacy.event(definition.type, event.data)).pipe(
        Effect.mapError(() => new InvalidRequestError({ message: "Invalid durable event data", field: "event.data" })),
      )
      if (event.data[definition.durable.aggregate] !== event.aggregateID)
        return yield* new InvalidRequestError({
          message: "Durable event aggregate mismatch",
          field: "event.aggregateID",
        })
      yield* bus
        .replay(event, {
          publish: payload.publish ?? true,
          ownerID: payload.ownerID,
          strictOwner: payload.strictOwner ?? true,
        })
        .pipe(
          Effect.catchDefect((defect) =>
            defect instanceof Bus.InvalidDurableEventError
              ? Effect.fail(new ConflictError({ message: defect.message, resource: event.aggregateID }))
              : Effect.die(defect),
          ),
        )
      return HttpApiSchema.NoContent.make()
    })
})
