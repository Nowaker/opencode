import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import path from "node:path"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("HTTP synthetic append returns the projected identity, publishes native SSE and rejects queue controls", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: path.join(tmp.path, "append-v2.db") },
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
    const created = yield* request("POST", "/api/session", { title: "Append fixture" })
    expect(created.status).toBe(200)
    const session = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Struct({ id: Session.ID }) }))(
      yield* Effect.promise(() => created.json()),
    ).data
    const route = `/api/session/${session.id}/synthetic`
    const info = yield* request("GET", "/api/info")
    expect(yield* Effect.promise(() => info.json())).toMatchObject({
      capabilities: { syntheticAppend: true, sessionMetadataMergePatch: true },
    })

    const id = SessionMessage.ID.create()
    const response = yield* request("POST", route, {
      id,
      mode: "append",
      text: "HTTP append",
      ignored: false,
      description: "Finished",
      metadata: { job: "http" },
    })

    expect(response.status).toBe(200)
    expect(yield* Effect.promise(() => response.json())).toEqual({ data: { id } })
    for (const controls of [
      { resume: true },
      { resume: false },
      { resume: null },
      { delivery: "queue" },
      { delivery: "steer" },
      { delivery: null },
    ]) {
      const rejected = yield* request("POST", route, { mode: "append", text: "Invalid controls", ...controls })
      expect(rejected.status).toBe(400)
    }
    expect((yield* request("POST", route, { mode: "append", id: "invalid", text: "Invalid ID" })).status).toBe(400)
    const messages = yield* request("GET", `/api/session/${session.id}/message`)
    expect(messages.status).toBe(200)
    expect(yield* Effect.promise(() => messages.json())).toMatchObject({
      data: [{ id, type: "synthetic", text: "HTTP append", ignored: false, metadata: { job: "http" } }],
    })
    const inbox = yield* request("GET", `/api/session/${session.id}/inbox`)
    expect(yield* Effect.promise(() => inbox.json())).toEqual({ data: [] })

    const log = yield* request("GET", `/api/experimental/session/${session.id}/log?follow=false`)
    expect(log.status).toBe(200)
    const records = (yield* Effect.promise(() => log.text()))
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(line.slice(5)))
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: id.replace(/^msg_/, "evt_"),
          type: "session.synthetic",
          data: {
            sessionID: session.id,
            text: "HTTP append",
            ignored: false,
            description: "Finished",
            metadata: { job: "http" },
          },
        }),
      ]),
    )

    const admitted = yield* request("POST", route, { text: "Ordinary admission", resume: false })
    expect(admitted.status).toBe(200)
    expect(yield* Effect.promise(() => admitted.json())).toMatchObject({
      data: { sessionID: session.id, type: "synthetic", delivery: "steer", payload: { text: "Ordinary admission" } },
    })
    const nullable = yield* request("POST", route, {
      id: null,
      description: null,
      delivery: null,
      resume: null,
      text: "Legacy nullable fields",
      ignored: true,
    })
    expect(nullable.status).toBe(200)
    expect(yield* Effect.promise(() => nullable.json())).toMatchObject({
      data: {
        sessionID: session.id,
        type: "synthetic",
        delivery: "steer",
        payload: { text: "Legacy nullable fields", ignored: true },
      },
    })
  }),
)
