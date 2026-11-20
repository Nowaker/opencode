import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { EngineStop } from "@opencode/schema/engine-stop"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerInfo } from "@opencode/protocol/groups/server"
import { ServerFetch } from "../src/fetch"

const route = "/api/experimental/server/stop"

const setup = Effect.gen(function* () {
  const tmp = yield* tmpdirScoped()
  const handler = yield* ServerFetch.make({
    app: { version: "engine-stop-test" },
    password: "engine-stop-test",
    database: { path: ":memory:" },
    config: { directory: tmp.path, project: false, claude: false, content: "{}" },
    fs: { filewatcher: false, fff: false },
    models: { fetch: false },
  })
  const request = (method: string, path: string, body?: unknown) =>
    Effect.promise(() =>
      handler(
        new Request(new URL(path, "http://engine-stop.local"), {
          method,
          headers: {
            "content-type": "application/json",
            authorization: `Basic ${btoa("opencode:engine-stop-test")}`,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      ),
    )
  const get = () =>
    request("GET", route).pipe(
      Effect.flatMap((response) => Effect.promise(() => response.json())),
      Effect.map(Schema.decodeUnknownSync(EngineStop.Info)),
    )
  return { request, get, handler, directory: tmp.path }
})

it.live("server info advertises the engine stop capability", () =>
  Effect.gen(function* () {
    const fixture = yield* setup
    const response = yield* fixture.request("GET", "/api/info")
    expect(response.status).toBe(200)
    const info = Schema.decodeUnknownSync(ServerInfo)(yield* Effect.promise(() => response.json()))
    expect(info.capabilities?.engineStop).toBe(true)
  }),
)

it.live("engine lifecycle routes require the normal server authorization", () =>
  Effect.gen(function* () {
    const fixture = yield* setup
    for (const [method, path] of [
      ["GET", route],
      ["POST", `${route}/prepare`],
      ["POST", `${route}/cancel`],
    ] as const) {
      const response = yield* Effect.promise(() =>
        fixture.handler(
          new Request(new URL(path, "http://engine-stop.local"), {
            method,
            headers: { "content-type": "application/json" },
            body: method === "POST" ? "{}" : undefined,
          }),
        ),
      )
      expect(response.status).toBe(401)
    }
    const info = yield* fixture.get()
    expect(info.state).toBe("open")
    expect(info.operation).toBeNull()
  }),
)

it.live("raw lifecycle receipts reconcile duplicates and require the matching cancellation token", () =>
  Effect.gen(function* () {
    const fixture = yield* setup
    const info = yield* fixture.get()
    expect(info).toMatchObject({ state: "open", activeClaims: 0 })
    const input = {
      expectedGeneration: info.generation,
      operationID: "stop-one",
      mode: "idle",
      expectedActivityRevision: info.activityRevision,
    }
    // An idle prepare answers once its barrier is installed; the seal settles after it, so wait for it (section 7).
    const response = yield* fixture.request("POST", `${route}/prepare`, { ...input, waitMs: 10_000 })
    expect(response.status).toBe(200)
    const sealed = Schema.decodeUnknownSync(EngineStop.Operation)(yield* Effect.promise(() => response.json()))
    expect(sealed.status).toBe("sealed")
    const repeated = yield* fixture.request("POST", `${route}/prepare`, { ...input, waitMs: 10_000 })
    expect(yield* Effect.promise(() => repeated.json())).toEqual(sealed)

    const cancel = { expectedGeneration: info.generation, operationID: input.operationID, token: sealed.token }
    const wrong = yield* fixture.request("POST", `${route}/cancel`, { ...cancel, token: "another-token" })
    expect(wrong.status).toBe(409)
    expect(Schema.decodeUnknownSync(EngineStop.ControlError)(yield* Effect.promise(() => wrong.json())).reason).toBe(
      "token-mismatch",
    )
    expect((yield* fixture.get()).state).toBe("sealed")

    const cancelled = yield* fixture.request("POST", `${route}/cancel`, cancel)
    expect(cancelled.status).toBe(200)
    expect(yield* Effect.promise(() => cancelled.json())).toEqual({ ...sealed, status: "cancelled" })
    const query = new URLSearchParams({ operationID: input.operationID, waitMs: "10000" })
    const reconciled = yield* fixture.request("GET", `${route}?${query}`)
    const current = Schema.decodeUnknownSync(EngineStop.Info)(yield* Effect.promise(() => reconciled.json()))
    expect(current.state).toBe("open")
    expect(current.operation).toEqual({ ...sealed, status: "cancelled" })
  }),
)

it.live("HTTP rejects an excessive request wait without installing a stop barrier", () =>
  Effect.gen(function* () {
    const fixture = yield* setup
    const info = yield* fixture.get()
    const query = new URLSearchParams({ waitMs: "30001" })
    expect((yield* fixture.request("GET", `${route}?${query}`)).status).toBe(400)
    expect(
      (yield* fixture.request("POST", `${route}/prepare`, {
        expectedGeneration: info.generation,
        operationID: "invalid-wait",
        mode: "force-restart",
        waitMs: 30_001,
      })).status,
    ).toBe(400)
    expect(yield* fixture.get()).toEqual(info)
  }),
)

it.live(
  "sealed HTTP actions distinguish fresh refusal and profile mutation from existing input with blocked wake",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const created = yield* fixture.request("POST", "/api/session", {
        title: "Sealed admission",
        location: { directory: fixture.directory },
      })
      expect(created.status).toBe(200)
      const session = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.toEncoded(Session.Info) }))(
        yield* Effect.promise(() => created.json()),
      ).data
      const prompt = `/api/session/${session.id}/prompt`
      const existingID = SessionMessage.ID.create()
      expect(
        (yield* fixture.request("POST", prompt, { id: existingID, text: "Already admitted", resume: false })).status,
      ).toBe(200)
      const info = yield* fixture.get()
      const sealed = yield* fixture.request("POST", `${route}/prepare`, {
        expectedGeneration: info.generation,
        operationID: "admission-stop",
        mode: "idle",
        expectedActivityRevision: info.activityRevision,
        waitMs: 30_000,
      })
      expect(Schema.decodeUnknownSync(EngineStop.Operation)(yield* Effect.promise(() => sealed.json())).status).toBe(
        "sealed",
      )

      for (const input of [
        {
          path: prompt,
          payload: { id: SessionMessage.ID.create(), text: "Request while sealed" },
          admission: { status: "not-admitted" },
        },
        {
          path: prompt,
          payload: { id: existingID, text: "Request while sealed" },
          admission: { status: "existing", inputID: existingID },
        },
        {
          path: `/api/session/${session.id}/agent`,
          payload: { agent: "sealed-profile-probe" },
          admission: { status: "not-admitted" },
        },
      ] as const) {
        const refused = yield* fixture.request("POST", input.path, input.payload)
        expect(refused.status).toBe(503)
        const error = Schema.decodeUnknownSync(EngineStop.RefusedError)(yield* Effect.promise(() => refused.json()))
        expect(error.admission).toEqual(input.admission)
        expect(error.retryable).toBe(true)
        expect(error.generation).toBe(info.generation)
      }
    }),
)

it.live("a sealed PATCH writes no field and reports one fresh refusal", () =>
  Effect.gen(function* () {
    const fixture = yield* setup
    const created = yield* fixture.request("POST", "/api/session", {
      title: "Before seal",
      location: { directory: fixture.directory },
    })
    const session = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.toEncoded(Session.Info) }))(
      yield* Effect.promise(() => created.json()),
    ).data
    const info = yield* fixture.get()
    yield* fixture.request("POST", `${route}/prepare`, {
      expectedGeneration: info.generation,
      operationID: "patch-stop",
      mode: "idle",
      expectedActivityRevision: info.activityRevision,
      waitMs: 30_000,
    })
    const refused = yield* fixture.request("PATCH", `/api/session/${session.id}`, {
      title: "After seal",
      metadata: { sealed: true },
    })
    expect(refused.status).toBe(503)
    expect(
      Schema.decodeUnknownSync(EngineStop.RefusedError)(yield* Effect.promise(() => refused.json())).admission,
    ).toEqual({ status: "not-admitted" })
    const current = yield* fixture.request("GET", `/api/session/${session.id}`)
    const after = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.toEncoded(Session.Info) }))(
      yield* Effect.promise(() => current.json()),
    ).data
    expect(after.title).toBe("Before seal")
    expect(after.metadata).toEqual(session.metadata)
  }),
)
