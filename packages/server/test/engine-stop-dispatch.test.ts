import { expect } from "bun:test"
import { EngineStop } from "@opencode/schema/engine-stop"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("sealed command, generation, move and schedule HTTP actions preserve canonical 503 refusals", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const handler = yield* ServerFetch.make({
      app: { version: "engine-stop-w24b" }, password: "engine-stop-w24b", database: { path: ":memory:" },
      config: { directory: directory.path, project: false, claude: false, content: '{"experimental":{"schedules":true}}' },
      fs: { filewatcher: false, fff: false }, models: { fetch: false },
    })
    const request = (method: string, path: string, payload?: unknown) => Effect.promise(() => handler(new Request(
      new URL(path, "http://engine-stop.local"), {
        method,
        headers: { "content-type": "application/json", authorization: `Basic ${btoa("opencode:engine-stop-w24b")}` },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      },
    )))
    const created = yield* request("POST", "/api/session", { title: "Dispatch fence", location: { directory: directory.path } })
    expect(created.status).toBe(200)
    const session = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.toEncoded(Session.Info) }))(
      yield* Effect.promise(() => created.json()),
    ).data
    const status = yield* request("GET", "/api/experimental/server/stop")
    const info = Schema.decodeUnknownSync(EngineStop.Info)(yield* Effect.promise(() => status.json()))
    const prepared = yield* request("POST", "/api/experimental/server/stop/prepare", {
      expectedGeneration: info.generation, expectedActivityRevision: info.activityRevision,
      operationID: "dispatch-stop", mode: "idle", waitMs: 10_000,
    })
    expect(Schema.decodeUnknownSync(EngineStop.Operation)(yield* Effect.promise(() => prepared.json())).status).toBe("sealed")
    for (const [path, payload] of [
      [`/api/session/${session.id}/command`, { name: "not-dispatched", text: "" }],
      [`/api/session/${session.id}/generate`, { prompt: "not-generated" }],
      [`/api/session/${session.id}/move`, { directory: directory.path }],
      ["/api/experimental/schedule", { sessionID: session.id, when: { in: "1 hour" }, prompt: "not-armed" }],
    ] as const) {
      const response = yield* request("POST", path, payload)
      expect(response.status).toBe(503)
      const refusal = Schema.decodeUnknownSync(EngineStop.RefusedError)(yield* Effect.promise(() => response.json()))
      expect(refusal.admission).toEqual({ status: "not-admitted" })
      expect(refusal.operationID).toBe(EngineStop.OperationID.make("dispatch-stop"))
    }
  }),
)
