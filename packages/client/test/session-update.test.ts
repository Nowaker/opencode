import { expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { OpenCode, Session } from "../src/effect/index"

for (const update of [{ title: "renamed" }, { archived: true }]) {
  test(`Effect session.update encodes ${JSON.stringify(update)} without metadata`, async () => {
    const requests: unknown[] = []
    const httpClient = HttpClient.make((request) => {
      requests.push(
        request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : undefined,
      )
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 204 })))
    })

    await Effect.gen(function* () {
      const client = yield* OpenCode.make({ baseUrl: "http://localhost:3000" })
      yield* client.session.update({ sessionID: Session.ID.make("ses_test"), ...update })
    }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient), Effect.runPromise)

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject(update)
    expect(requests[0]).not.toHaveProperty("metadata")
  })
}
