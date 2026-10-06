import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { Installation } from "../../src/installation"
import { MoveSession } from "@opencode-ai/core/control-plane/move-session"
import { ServerAuth } from "../../src/server/auth"
import { RootHttpApi } from "../../src/server/routes/instance/httpapi/api"
import { GlobalPaths } from "../../src/server/routes/instance/httpapi/groups/global"
import { controlHandlers } from "../../src/server/routes/instance/httpapi/handlers/control"
import { controlPlaneHandlers } from "../../src/server/routes/instance/httpapi/handlers/control-plane"
import { globalHandlers } from "../../src/server/routes/instance/httpapi/handlers/global"
import { authorizationLayer } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { schemaErrorLayer } from "../../src/server/routes/instance/httpapi/middleware/schema-error"
import { testEffect } from "../lib/effect"

const apiLayer = HttpRouter.serve(
  HttpApiBuilder.layer(RootHttpApi).pipe(
    Layer.provide([controlHandlers, controlPlaneHandlers, globalHandlers]),
    Layer.provide([authorizationLayer, schemaErrorLayer]),
    // Raw HttpApi routes expose an opaque handler context at the request boundary.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    HttpRouter.provideRequest(Layer.succeedContext(Context.empty() as Context.Context<unknown>)),
  ),
  { disableListenLog: true, disableLogger: true },
).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provide(Layer.mock(Auth.Service)({})),
  Layer.provide(Layer.mock(Config.Service)({})),
  Layer.provide(Layer.mock(MoveSession.Service)({})),
  Layer.provide(
    Layer.mock(Installation.Service)({
      method: () => Effect.succeed("npm"),
      latest: () => Effect.succeed("9.9.9"),
      upgrade: () => Effect.void,
    }),
  ),
  Layer.provide(ServerAuth.Config.configLayer({ password: Option.none(), username: "opencode" })),
)
const it = testEffect(apiLayer)

describe("global HttpApi", () => {
  it.live("returns current process and JSC memory diagnostics", () =>
    Effect.gen(function* () {
      const started = Date.now()
      const response = yield* HttpClientRequest.get(GlobalPaths.memory).pipe(HttpClient.execute)
      const memory = yield* response.json.pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(
            Schema.Struct({
              process: Schema.Struct({
                rss: Schema.Number,
                heap_total: Schema.Number,
                heap_used: Schema.Number,
                external: Schema.Number,
                array_buffers: Schema.Number,
              }),
              jsc_heap: Schema.Struct({
                heap_size: Schema.Number,
                heap_capacity: Schema.Number,
                extra_memory_size: Schema.Number,
                object_count: Schema.Number,
                protected_object_count: Schema.Number,
                global_object_count: Schema.Number,
                object_type_counts: Schema.Record(Schema.String, Schema.Number),
              }),
              jsc_memory: Schema.Struct({
                current: Schema.Number,
                peak: Schema.Number,
                current_commit: Schema.Number,
                peak_commit: Schema.Number,
                page_faults: Schema.Number,
              }),
              captured_at: Schema.String,
            }),
          ),
        ),
      )

      expect(response.status).toBe(200)
      expect(memory.process.rss).toBeGreaterThan(0)
      expect(memory.jsc_heap.heap_capacity).toBeGreaterThan(0)
      expect(memory.jsc_heap.object_count).toBeGreaterThan(0)
      expect(memory.jsc_memory.peak).toBeGreaterThanOrEqual(memory.jsc_memory.current)
      expect(Date.parse(memory.captured_at)).toBeGreaterThanOrEqual(started)
      expect(Date.parse(memory.captured_at)).toBeLessThanOrEqual(Date.now())
    }),
  )

  it.live("upgrades to the requested version", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post(GlobalPaths.upgrade).pipe(
        HttpClientRequest.bodyJsonUnsafe({ target: "9.9.9" }),
        HttpClient.execute,
      )

      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual({ success: true, version: "9.9.9" })
    }),
  )

  it.live("rejects invalid upgrade payloads", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post(GlobalPaths.upgrade).pipe(
        HttpClientRequest.bodyJsonUnsafe({ target: 1 }),
        HttpClient.execute,
      )

      expect(response.status).toBe(400)
    }),
  )

  it.live("rejects invalid upgrade target versions", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post(GlobalPaths.upgrade).pipe(
        HttpClientRequest.bodyJsonUnsafe({ target: "latest" }),
        HttpClient.execute,
      )

      expect(response.status).toBe(400)
    }),
  )

  it.live("rejects unsupported upgrade content types", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post(GlobalPaths.upgrade).pipe(
        HttpClientRequest.setBody(HttpBody.text('{"target":"1.0.0"}', "text/plain")),
        HttpClient.execute,
      )

      expect(response.status).toBe(415)
    }),
  )
})
