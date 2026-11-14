import { ClientError, OpenCode, Session } from "@opencode/client/effect"
import { Service, type Endpoint } from "@opencode/client/effect/service"
import { Effect, Schedule } from "effect"
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest } from "effect/http"

export class ServerWaitTimeout extends Error {
  override readonly name = "ServerWaitTimeout"
}

// One scoped timer covers both readiness stages, including in-flight requests and every retry sleep. Interruption
// aborts the HTTP client's request; successful readiness cancels the timer as well.
export const waitForServer = Effect.fn("cli.server-wait")(function* (
  endpoint: Endpoint,
  milliseconds: number,
  sessionID?: string,
) {
  return yield* Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const client = yield* OpenCode.make({ baseUrl: endpoint.url }).pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.mapRequest(http, HttpClientRequest.setHeaders(Service.headers(endpoint) ?? {})),
      ),
    )
    const health = yield* client.server
      .info()
      .pipe(Effect.retry({ while: transient, schedule: Schedule.spaced("100 millis") }))
    if (sessionID !== undefined) {
      const session = yield* client.session.get({ sessionID: Session.ID.make(sessionID) }).pipe(
        Effect.retry({
          while: (cause) => cause._tag === "SessionNotFoundError" || transient(cause),
          schedule: Schedule.spaced("100 millis"),
        }),
      )
      if (session.id !== sessionID)
        return yield* Effect.fail(new Error(`Server returned a different session than ${sessionID}`))
    }
    return health
  }).pipe(
    Effect.timeoutOrElse({
      duration: milliseconds,
      orElse: () => Effect.fail(new ServerWaitTimeout(sessionID ? ` and session ${sessionID}` : "")),
    }),
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
  )
})

function transient(cause: unknown) {
  if (!(cause instanceof ClientError) || !HttpClientError.isHttpClientError(cause.cause)) return false
  if (cause.cause.response) return [502, 503, 504].includes(cause.cause.response.status)
  const reason = cause.cause.reason
  if (reason._tag !== "TransportError") return false
  for (let error = reason.cause; error instanceof Error; error = error.cause)
    if (
      "code" in error &&
      ["ECONNREFUSED", "ECONNRESET", "EPIPE", "ConnectionRefused", "ConnectionClosed"].includes(String(error.code))
    )
      return true
  return false
}
