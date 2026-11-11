import { expect } from "bun:test"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })

const setup = () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      events: { persist: true },
      config: { directory: tmp.path, project: false, claude: false, content: "{}" },
      fs: { filewatcher: false, fff: false },
      models: { fetch: false },
    })
    const request = (method: string, route: string, body?: unknown) =>
      Effect.promise(() =>
        handler(
          new Request(new URL(route, "http://opencode.local"), {
            method,
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        ),
      )
    const created = yield* request("POST", "/api/session", {
      metadata: { namespace: { note: "old", remove: true }, other: { keep: true } },
      title: "Metadata fixture",
    })
    expect(created.status).toBe(200)
    const session = Schema.decodeUnknownSync(SessionResponse)(yield* Effect.promise(() => created.json())).data
    const get = () =>
      request("GET", `/api/session/${session.id}`).pipe(
        Effect.flatMap((response) => Effect.promise(() => response.json())),
        Effect.map(Schema.decodeUnknownSync(SessionResponse)),
      )
    return { request, session, get }
  })

it.live("merges selected metadata keys through the experimental PATCH selector and advertises support", () =>
  Effect.gen(function* () {
    const fixture = yield* setup()
    const info = yield* fixture.request("GET", "/api/info")
    expect(yield* Effect.promise(() => info.json())).toMatchObject({
      capabilities: { sessionMetadataMergePatch: true },
    })

    const response = yield* fixture.request("PATCH", `/api/session/${fixture.session.id}`, {
      metadata: { namespace: { note: "new", remove: null } },
      experimental: { metadataMode: "merge" },
    })

    expect(response.status).toBe(204)
    expect((yield* fixture.get()).data.metadata).toEqual({ namespace: { note: "new" }, other: { keep: true } })
  }),
)

for (const metadataMode of [undefined, "replace"] as const) {
  it.live(`keeps literal null and whole-record replacement for ${metadataMode ?? "default"} mode`, () =>
    Effect.gen(function* () {
      const fixture = yield* setup()

      const response = yield* fixture.request("PATCH", `/api/session/${fixture.session.id}`, {
        metadata: { literal: null, nested: { one: null } },
        experimental: metadataMode === undefined ? undefined : { metadataMode },
      })

      expect(response.status).toBe(204)
      expect((yield* fixture.get()).data.metadata).toEqual({ literal: null, nested: { one: null } })
    }),
  )
}

it.live("rejects an unknown metadata mode without replacing the current record", () =>
  Effect.gen(function* () {
    const fixture = yield* setup()

    const response = yield* fixture.request("PATCH", `/api/session/${fixture.session.id}`, {
      metadata: { lost: true },
      experimental: { metadataMode: "merg" },
    })

    expect(response.status).toBe(400)
    expect((yield* fixture.get()).data.metadata).toEqual({
      namespace: { note: "old", remove: true },
      other: { keep: true },
    })
  }),
)

for (const metadata of [null, [], "scalar"]) {
  it.live(`rejects non-record merge metadata ${JSON.stringify(metadata)} without changing stored keys`, () =>
    Effect.gen(function* () {
      const fixture = yield* setup()

      const response = yield* fixture.request("PATCH", `/api/session/${fixture.session.id}`, {
        metadata,
        experimental: { metadataMode: "merge" },
      })

      expect(response.status).toBe(400)
      expect((yield* fixture.get()).data.metadata).toEqual({
        namespace: { note: "old", remove: true },
        other: { keep: true },
      })
    }),
  )
}

it.live("leaves metadata unchanged when a title update omits metadata in merge mode", () =>
  Effect.gen(function* () {
    const fixture = yield* setup()

    const response = yield* fixture.request("PATCH", `/api/session/${fixture.session.id}`, {
      title: "Renamed",
      experimental: { metadataMode: "merge" },
    })

    expect(response.status).toBe(204)
    expect((yield* fixture.get()).data).toMatchObject({
      title: "Renamed",
      metadata: { namespace: { note: "old", remove: true }, other: { keep: true } },
    })
  }),
)
