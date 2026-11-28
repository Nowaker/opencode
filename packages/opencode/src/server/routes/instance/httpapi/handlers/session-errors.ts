import type { NotFoundError } from "@/storage/storage"
import { Session } from "@/session/session"
import { Effect } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiError } from "effect/unstable/httpapi"
import { SessionArchive } from "@/session/archive"
import { MessageHistoryState } from "@/session/message-history-state"
import { SessionPause } from "@/session/pause"
import * as ApiError from "../errors"

export function mapStorageNotFound<A, R>(self: Effect.Effect<A, NotFoundError, R>) {
  return self.pipe(Effect.mapError((error) => ApiError.notFound(error.message)))
}

export function mapProtectedHistory<A, E, R>(self: Effect.Effect<A, MessageHistoryState.Error | E, R>) {
  return Effect.catchIf(
    self,
    (error): error is MessageHistoryState.Error => error instanceof MessageHistoryState.Error,
    (error) => Effect.fail(
      new ApiError.ProtectedMessageHistoryError({
        name: "ProtectedMessageHistoryError",
        data: { code: error.code, message: error.message },
      }),
    ),
  )
}

export function mapBusy<A, E, R>(self: Effect.Effect<A, Session.BusyError | E, R>) {
  return self.pipe(
    Effect.mapError((error) =>
      error instanceof Session.BusyError
        ? new ApiError.SessionBusyError({
            sessionID: error.sessionID,
            message: `Session is busy: ${error.sessionID}`,
          })
        : error,
    ),
  )
}

export function mapPauseChanged<A, E, R>(self: Effect.Effect<A, SessionPause.ChangedError | E, R>) {
  return self.pipe(
    Effect.mapError((error) =>
      error instanceof SessionPause.ChangedError
        ? new ApiError.PauseChangedError({
            sessionID: error.sessionID,
            message: "The pause changed; no action was taken",
          })
        : error,
    ),
  )
}

export const archiveClient = Effect.map(HttpServerRequest.HttpServerRequest, (request) =>
  request.headers["x-opencode-client"] === "tui" ? ("tui" as const) : ("api" as const),
)

export function mapArchive<A, E, R>(self: Effect.Effect<A, SessionArchive.Error | E, R>) {
  return Effect.gen(function* () {
    const client = yield* archiveClient
    return yield* self.pipe(
      Effect.provideService(SessionArchive.Client, client),
      Effect.mapError((error) =>
        error instanceof SessionArchive.Error
          ? new ApiError.SessionArchivedError({ name: "SessionArchivedError", data: error.data })
          : error,
      ),
    )
  })
}

export function mapPromptRequest<A, E, R>(self: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const client = yield* archiveClient
    return yield* self.pipe(
      Effect.provideService(SessionArchive.Client, client),
      Effect.mapError((error): HttpApiError.BadRequest | ApiError.ProtectedMessageHistoryError | ApiError.SessionArchivedError => {
        if (error instanceof SessionArchive.Error)
          return new ApiError.SessionArchivedError({ name: "SessionArchivedError", data: error.data })
        if (error instanceof MessageHistoryState.Error)
          return new ApiError.ProtectedMessageHistoryError({
            name: "ProtectedMessageHistoryError",
            data: { code: error.code, message: error.message },
          })
        return new HttpApiError.BadRequest({})
      }),
    )
  })
}
