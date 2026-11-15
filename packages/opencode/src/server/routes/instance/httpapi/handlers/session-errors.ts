import type { NotFoundError as StorageNotFoundError } from "@/storage/storage"
import { Session } from "@/session/session"
import { Effect } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { SessionArchive } from "@/session/archive"
import * as ApiError from "../errors"

export function mapStorageNotFound<A, R>(self: Effect.Effect<A, StorageNotFoundError, R>) {
  return self.pipe(Effect.mapError((error) => ApiError.notFound(error.message)))
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
