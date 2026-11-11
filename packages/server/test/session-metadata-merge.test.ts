import { expect } from "bun:test"
import { Database } from "bun:sqlite"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import path from "node:path"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const Response = Schema.Struct({ data: Schema.toEncoded(Session.Info) })
const StoredEvent = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  created: Schema.Number,
  seq: Schema.Number,
  aggregate_id: Schema.String,
  data: Schema.String,
})

const setup = (metadata: Session.Metadata) =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const filename = path.join(tmp.path, "metadata-v2.db")
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: filename },
      events: { persist: true },
      config: { project: false, claude: false, content: "{}" },
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
    const created = yield* request("POST", "/api/session", { metadata, title: "Metadata fixture" })
    expect(created.status).toBe(200)
    const session = Schema.decodeUnknownSync(Response)(yield* Effect.promise(() => created.json())).data
    const get = () =>
      request("GET", `/api/session/${session.id}`).pipe(
        Effect.flatMap((response) => Effect.promise(() => response.json())),
        Effect.map(Schema.decodeUnknownSync(Response)),
      )
    const db = yield* Effect.acquireRelease(
      Effect.sync(() => new Database(filename, { readonly: true })),
      (db) => Effect.sync(() => db.close()),
    )
    return { request, session, get, db }
  })

it.live("merges only selected metadata keys through the explicit PATCH selector", () =>
  Effect.gen(function* () {
    const fixture = yield* setup({ vibeterm: { note: "old", remove: true }, other: { keep: true } })
    const info = yield* fixture.request("GET", "/api/info")
    expect(yield* Effect.promise(() => info.json())).toMatchObject({
      capabilities: { sessionMetadataMergePatch: true },
    })

    const response = yield* fixture.request("PATCH", `/api/session/${fixture.session.id}`, {
      metadata: { vibeterm: { note: "new", remove: null } },
      experimental: { metadataMode: "merge" },
    })

    expect(response.status).toBe(204)
    expect((yield* fixture.get()).data.metadata).toEqual({ vibeterm: { note: "new" }, other: { keep: true } })
  }),
)

it.live("keeps literal null and whole-record replacement for default and explicit replace modes", () =>
  Effect.gen(function* () {
    const fixture = yield* setup({ omitted: true, nested: { old: 1 } })

    expect(
      (yield* fixture.request("PATCH", `/api/session/${fixture.session.id}`, {
        metadata: { literal: null, nested: { one: null } },
      })).status,
    ).toBe(204)
    expect((yield* fixture.get()).data.metadata).toEqual({ literal: null, nested: { one: null } })
    expect(
      (yield* fixture.request("PATCH", `/api/session/${fixture.session.id}`, {
        metadata: { final: null },
        experimental: { metadataMode: "replace" },
      })).status,
    ).toBe(204)
    expect((yield* fixture.get()).data.metadata).toEqual({ final: null })
  }),
)

it.live("rejects an unknown metadata mode without replacing the current record", () =>
  Effect.gen(function* () {
    const fixture = yield* setup({ preserved: true })

    const response = yield* fixture.request("PATCH", `/api/session/${fixture.session.id}`, {
      metadata: { lost: true },
      experimental: { metadataMode: "merg" },
    })

    expect(response.status).toBe(400)
    expect((yield* fixture.get()).data.metadata).toEqual({ preserved: true })
  }),
)

for (const metadata of [null, [], "scalar"]) {
  it.live(`rejects non-record merge metadata ${JSON.stringify(metadata)} without changing stored keys`, () =>
    Effect.gen(function* () {
      const fixture = yield* setup({ preserved: true })

      const response = yield* fixture.request("PATCH", `/api/session/${fixture.session.id}`, {
        metadata,
        experimental: { metadataMode: "merge" },
      })

      expect(response.status).toBe(400)
      expect((yield* fixture.get()).data.metadata).toEqual({ preserved: true })
    }),
  )
}

it.live("stores a full merged event that replays identically over a receiving baseline", () =>
  Effect.gen(function* () {
    const fixture = yield* setup({ stable: 1, nested: { retained: true, removed: true } })
    expect(
      (yield* fixture.request("PATCH", `/api/session/${fixture.session.id}`, {
        metadata: { nested: { removed: null }, added: [1, 2] },
        experimental: { metadataMode: "merge" },
      })).status,
    ).toBe(204)
    const expected = { stable: 1, nested: { retained: true }, added: [1, 2] }
    expect((yield* fixture.get()).data.metadata).toEqual(expected)
    const stored = Schema.decodeUnknownSync(StoredEvent)(
      fixture.db
        .query("SELECT * FROM event WHERE aggregate_id = ? AND type = 'session.metadata.updated.1'")
        .get(fixture.session.id),
    )
    expect(JSON.parse(stored.data)).toEqual({ sessionID: fixture.session.id, metadata: expected })
    const receiver = yield* ServerFetch.make({
      app: { version: "receiver" },
      database: { path: ":memory:" },
      events: { persist: true },
      config: { project: false, claude: false, content: "{}" },
      fs: { filewatcher: false, fff: false },
      models: { fetch: false },
    })
    const request = (method: string, route: string, body?: unknown) =>
      Effect.promise(() =>
        receiver(
          new Request(new URL(route, "http://receiver.local"), {
            method,
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        ),
      )
    const baseline = yield* request("POST", "/api/session", {
      id: fixture.session.id,
      metadata: { receiverOnly: true },
      title: "Receiving baseline",
    })
    expect(baseline.status).toBe(200)
    expect(Schema.decodeUnknownSync(Response)(yield* Effect.promise(() => baseline.json())).data.metadata).toEqual({
      receiverOnly: true,
    })

    expect(
      (yield* request("POST", "/api/experimental/event/replay", {
        event: {
          id: stored.id,
          type: stored.type,
          created: stored.created,
          seq: stored.seq,
          aggregateID: stored.aggregate_id,
          data: JSON.parse(stored.data),
        },
        ownerID: "source",
        strictOwner: true,
        publish: true,
      })).status,
    ).toBe(204)

    const read = yield* request("GET", `/api/session/${fixture.session.id}`)
    expect(Schema.decodeUnknownSync(Response)(yield* Effect.promise(() => read.json())).data.metadata).toEqual(expected)
  }),
)
