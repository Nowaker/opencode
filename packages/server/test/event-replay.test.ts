import { expect } from "bun:test"
import { Database } from "bun:sqlite"
import { Event } from "@opencode/schema/event"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import path from "node:path"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const Created = Schema.Struct({ data: Session.Info })
const replayPath = "/api/experimental/event/replay"

const setup = Effect.gen(function* () {
  const tmp = yield* tmpdirScoped()
  const file = path.join(tmp.path, "events-v2.db")
  const handler = yield* ServerFetch.make({
    app: { version: "test" },
    password: "event-replay-fixture",
    database: { path: file },
    events: { persist: true },
    config: { project: false, claude: false, content: "{}" },
    fs: { filewatcher: false, fff: false },
    models: { fetch: false },
  })
  const request = (route: string, body?: unknown, authorized = true) =>
    Effect.promise(() =>
      handler(
        new Request(new URL(route, "http://opencode.local"), {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "content-type": "application/json",
            ...(authorized ? { authorization: `Basic ${btoa("opencode:event-replay-fixture")}` } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      ),
    )
  const response = yield* request("/api/session", { title: "Original" })
  expect(response.status).toBe(200)
  const session = Schema.decodeUnknownSync(Created)(yield* Effect.promise(() => response.json())).data
  const db = yield* Effect.acquireRelease(
    Effect.sync(() => new Database(file, { readonly: true })),
    (db) => Effect.sync(() => db.close()),
  )
  const event = {
    id: Event.ID.create(),
    type: "session.renamed.1",
    created: 1234,
    seq: 1,
    aggregateID: session.id,
    data: { sessionID: session.id, title: "Replayed" },
  }
  const replay = (body: unknown, authorized = true) => request(replayPath, body, authorized)
  return { session, event, db, request, replay }
})

it.live("replays at the original sequence and treats an exact HTTP retry as a no-op", () =>
  Effect.gen(function* () {
    const fixture = yield* setup
    const payload = { event: fixture.event, ownerID: "origin" }
    expect((yield* fixture.replay(payload)).status).toBe(204)

    expect((yield* fixture.replay(payload)).status).toBe(204)

    expect(
      fixture.db.query("SELECT id, seq FROM event WHERE aggregate_id = ? AND seq = 1").all(fixture.session.id),
    ).toEqual([{ id: fixture.event.id, seq: 1 }])
    const response = yield* fixture.request(`/api/session/${fixture.session.id}`)
    expect(Schema.decodeUnknownSync(Created)(yield* Effect.promise(() => response.json())).data.title).toBe("Replayed")
  }),
)

it.live("rejects a strict owner mismatch even for an exact event retry", () =>
  Effect.gen(function* () {
    const fixture = yield* setup
    expect((yield* fixture.replay({ event: fixture.event, ownerID: "origin" })).status).toBe(204)

    const response = yield* fixture.replay({ event: fixture.event, ownerID: "other", strictOwner: true })

    expect(response.status).toBe(409)
    expect(yield* Effect.promise(() => response.json())).toMatchObject({
      _tag: "ConflictError",
      message: expect.stringContaining("Replay owner mismatch"),
    })
    expect(
      fixture.db.query("SELECT seq, owner_id FROM event_sequence WHERE aggregate_id = ?").get(fixture.session.id),
    ).toEqual({ seq: 1, owner_id: "origin" })
  }),
)

for (const collision of ["id", "data", "gap", "reused-id"] as const) {
  it.live(`rejects a ${collision} sequence conflict through HTTP without advancing the aggregate`, () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      expect((yield* fixture.replay({ event: fixture.event, ownerID: "origin" })).status).toBe(204)
      const event =
        collision === "id"
          ? { ...fixture.event, id: Event.ID.create() }
          : collision === "data"
            ? { ...fixture.event, data: { ...fixture.event.data, title: "Diverged" } }
            : { ...fixture.event, seq: collision === "gap" ? 3 : 2 }

      const response = yield* fixture.replay({ event, ownerID: "origin" })

      expect(response.status).toBe(409)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({ _tag: "ConflictError" })
      expect(fixture.db.query("SELECT seq FROM event_sequence WHERE aggregate_id = ?").get(fixture.session.id)).toEqual(
        { seq: 1 },
      )
    }),
  )
}

for (const invalid of ["type", "data", "aggregate", "seq"] as const) {
  it.live(`rejects invalid event ${invalid} at the replay boundary`, () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const event =
        invalid === "type"
          ? { ...fixture.event, type: "server.connected" }
          : invalid === "data"
            ? { ...fixture.event, data: { ...fixture.event.data, title: 123 } }
            : invalid === "aggregate"
              ? { ...fixture.event, aggregateID: "different" }
              : { ...fixture.event, seq: -1 }

      const response = yield* fixture.replay({ event, ownerID: "origin" })

      expect(response.status).toBe(400)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({ _tag: "InvalidRequestError" })
      expect(fixture.db.query("SELECT seq FROM event_sequence WHERE aggregate_id = ?").get(fixture.session.id)).toEqual(
        { seq: 0 },
      )
    }),
  )
}

it.live("requires the server's existing authentication to replay", () =>
  Effect.gen(function* () {
    const fixture = yield* setup

    const response = yield* fixture.replay({ event: fixture.event, ownerID: "origin" }, false)

    expect(response.status).toBe(401)
    expect(fixture.db.query("SELECT seq FROM event_sequence WHERE aggregate_id = ?").get(fixture.session.id)).toEqual({
      seq: 0,
    })
  }),
)
