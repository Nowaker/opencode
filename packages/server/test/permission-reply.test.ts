import { expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/schema/session"
import { Context, Deferred, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const replies: ReadonlyArray<{
  decision: "defer" | "reject" | "once" | "always"
  scope?: "request"
  message?: string
}> = [
  { decision: "defer", message: "HTTP exact\nKeep working." },
  { decision: "defer", message: "" },
  { decision: "defer" },
  { decision: "reject", scope: "request", message: "HTTP correction" },
  { decision: "reject", message: "Batch correction" },
  { decision: "once" },
  { decision: "always" },
]
for (const reply of replies)
  it.live(`HTTP permission reply ${JSON.stringify(reply)} preserves native settlement and ownership`, () =>
    Effect.gen(function* () {
      const permissions = yield* Deferred.make<Permission.Interface>()
      const buses = yield* Deferred.make<Bus.Interface>()
      const handler = yield* ServerFetch.make(
        {
          app: { version: "test" },
          database: { path: ":memory:" },
          config: { project: false, claude: false, content: "{}" },
          fs: { filewatcher: false, fff: false },
          models: { fetch: false },
        },
        {
          overrides: [
            Permission.node.replace(
              Permission.node.mapLayer((layer) =>
                Layer.tap(layer, (context) => Deferred.succeed(permissions, Context.get(context, Permission.Service))),
              ),
            ),
            Bus.node.replace(
              Bus.node.mapLayer((layer) =>
                Layer.tap(layer, (context) => Deferred.succeed(buses, Context.get(context, Bus.Service))),
              ),
            ),
          ],
        },
      )
      const request = (route: string, body?: unknown) =>
        Effect.promise(async () => {
          const response = await handler(
            new Request(new URL(route, "http://opencode.local"), {
              method: body === undefined ? "GET" : "POST",
              headers: { "content-type": "application/json" },
              body: body === undefined ? undefined : JSON.stringify(body),
            }),
          )
          return { status: response.status, body: response.status === 204 ? undefined : await response.json() }
        })
      const create = () =>
        request("/api/session", { permissions: [{ action: "deploy", resource: "*", effect: "ask" }] }).pipe(
          Effect.map(
            (response) =>
              Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Struct({ id: Session.ID }) }))(response.body).data
                .id,
          ),
        )
      const sessionID = yield* create()
      const otherID = yield* create()
      const ask = (id: Session.ID, resources: ReadonlyArray<string>) =>
        request(`/api/session/${id}/permission`, { action: "deploy", resources }).pipe(
          Effect.map(
            (response) =>
              Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Struct({ id: Permission.ID }) }))(response.body)
                .data.id,
          ),
        )
      const sibling = yield* ask(sessionID, ["sibling"])
      const other = yield* ask(otherID, ["other"])
      const service = yield* Deferred.await(permissions)
      const bus = yield* Deferred.await(buses)
      const target = Permission.ID.create()
      const ready = yield* Deferred.make<void>()
      yield* bus.subscribe(Permission.Event.Asked).pipe(
        Stream.filter((event) => event.data.id === target),
        Stream.runForEach(() => Deferred.succeed(ready, undefined)),
        Effect.forkScoped({ startImmediately: true }),
      )
      const assertion = yield* service
        .assert({ id: target, sessionID, action: "deploy", resources: ["target"], save: ["target"] })
        .pipe(Effect.exit, Effect.forkScoped)
      yield* Deferred.await(ready)
      const route = `/api/session/${sessionID}/permission/${target}/reply`
      expect((yield* request(`/api/session/${otherID}/permission/${target}/reply`, reply)).status).toBe(404)
      for (const decision of ["once", "always", "defer"])
        expect((yield* request(route, { decision, scope: "request" })).status).toBe(400)
      expect((yield* request(route, { decision: "reject", scope: "session" })).status).toBe(400)
      expect((yield* service.list()).map((item) => item.id)).toEqual([sibling, other, target])
      expect(assertion.pollUnsafe()).toBeUndefined()
      expect((yield* request("/api/info")).body).toMatchObject({
        capabilities: {
          permissionDefer: true,
          permissionRejectIsolation: true,
          syntheticAppend: true,
          jobControl: true,
        },
      })

      expect(yield* request(route, reply)).toEqual({ status: 204, body: undefined })

      const result = yield* Fiber.join(assertion)
      if (reply.decision === "defer" || reply.decision === "reject")
        expect(result).toMatchObject({
          _tag: "Failure",
          cause: {
            reasons: [
              {
                _tag: "Fail",
                error: {
                  _tag: reply.decision === "defer" ? "Permission.DeferredError" : "Permission.CorrectedError",
                  feedback:
                    reply.message ??
                    "This permission request was deferred: nobody has answered it yet, and it was not refused. Continue with other work.",
                  message:
                    reply.message ??
                    "This permission request was deferred: nobody has answered it yet, and it was not refused. Continue with other work.",
                },
              },
            ],
          },
        })
      if (reply.decision === "once" || reply.decision === "always") expect(result._tag).toBe("Success")
      const cascade = reply.decision === "reject" && reply.scope === undefined
      expect((yield* service.list()).map((item) => item.id)).toEqual(cascade ? [other] : [sibling, other])
      expect((yield* request(route, reply)).status).toBe(404)
      expect((yield* request(`/api/session/ses_missing/permission/${target}/reply`, reply)).status).toBe(404)
    }),
  )
