import { expect } from "bun:test"
import { RouteSwitch } from "@opencode/schema/route-switch"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const ownerAuthorization = `Basic ${btoa("opencode:fixture-auto-switch")}`
const readStatus = Schema.decodeUnknownSync(Schema.Struct({ data: RouteSwitch.Status }))

const fixture = Effect.gen(function* () {
  const server = yield* ServerFetch.make({
    password: "fixture-auto-switch",
    database: { path: ":memory:" },
    config: { project: false, claude: false, content: "{}" },
    fs: { filewatcher: false, fff: false },
    models: { fetch: false },
  })
  const request = (
    path: string,
    input: {
      readonly body?: object
      readonly authorized?: boolean
      readonly method?: "POST"
    } = {},
  ) =>
    Effect.promise(() =>
      server(
        new Request(new URL(path, "http://opencode.local"), {
          method: input.method ?? (input.body === undefined ? "GET" : "PUT"),
          headers: {
            "content-type": "application/json",
            ...(input.authorized === false ? {} : { authorization: ownerAuthorization }),
          },
          body: input.body === undefined ? undefined : JSON.stringify(input.body),
        }),
      ),
    )
  const created = yield* Effect.promise(() =>
    server(
      new Request("http://opencode.local/api/session", {
        method: "POST",
        headers: { authorization: ownerAuthorization, "content-type": "application/json" },
        body: JSON.stringify({ title: "Auto-switch control fixture" }),
      }),
    ),
  )
  expect(created.status).toBe(200)
  const result = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Struct({ id: Session.ID }) }))(
    yield* Effect.promise(() => created.json()),
  )
  return { request, path: `/api/experimental/session/${result.data.id}/auto-switch` }
})

it.live("requires authentication before exposing an owner's session auto-switch status", () =>
  Effect.gen(function* () {
    const owner = yield* fixture
    const denied = yield* owner.request(owner.path, { authorized: false })
    expect(denied.status).toBe(401)
  }),
)

it.live("refuses to save policy without a managed policy adapter and returns the unavailable snapshot", () =>
  Effect.gen(function* () {
    const owner = yield* fixture
    const status = yield* owner.request(owner.path)
    expect(status.status).toBe(200)
    expect(status.headers.get("cache-control")).toBe("no-store")
    const before = readStatus(yield* Effect.promise(() => status.json())).data
    expect(before.availability).toBe("unavailable")

    const response = yield* owner.request(owner.path, {
      body: { action: "set-preference", preference: "on", ownerEpoch: "not-a-managed-owner", revision: 0 },
    })
    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(readStatus(yield* Effect.promise(() => response.json())).data).toEqual(before)
  }),
)

it.live("requires authentication before requesting retry of a quota-stopped step", () =>
  Effect.gen(function* () {
    const owner = yield* fixture
    const denied = yield* owner.request(`${owner.path}/retry`, {
      method: "POST",
      authorized: false,
      body: { ownerEpoch: "fixture-owner", revision: 0 },
    })
    expect(denied.status).toBe(401)
  }),
)
