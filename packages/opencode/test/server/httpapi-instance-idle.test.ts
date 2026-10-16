import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { expect } from "bun:test"
import { Context, Deferred, Effect, Fiber, Layer, Schema, Scope, Stream } from "effect"
import { HttpClient, HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware } from "effect/unstable/httpapi"
import { Socket } from "effect/unstable/socket"
import { InstanceRef } from "../../src/effect/instance-ref"
import { registerDisposer } from "../../src/effect/instance-registry"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { OwnerQuiescence } from "../../src/owner/quiescence"
import {
  InstanceContextMiddleware,
  InstanceIdleTimeout,
  instanceContextLayer,
} from "../../src/server/routes/instance/httpapi/middleware/instance-context"
import { WorkspaceRouteContext } from "../../src/server/routes/instance/httpapi/middleware/workspace-routing"
import { tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"

class Routing extends HttpApiMiddleware.Service<Routing, { provides: WorkspaceRouteContext }>()("IdleProbeRouting") {}
class Control extends Context.Service<
  Control,
  {
    readonly started: Deferred.Deferred<void>
    readonly finish: Deferred.Deferred<void>
  }
>()("IdleProbeControl") {}
const control = Layer.effect(
  Control,
  Effect.gen(function* () {
    return { started: yield* Deferred.make<void>(), finish: yield* Deferred.make<void>() }
  }),
)

const routing = Layer.succeed(Routing)(
  Routing.of((effect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const directory = new URL(request.url, "http://localhost").searchParams.get("directory")
      if (!directory) return yield* Effect.die(new Error("missing probe directory"))
      return yield* effect.pipe(Effect.provideService(WorkspaceRouteContext, { directory }))
    }),
  ),
)

const query = Schema.Struct({ directory: Schema.String })
const Api = HttpApi.make("idle-probe").add(
  HttpApiGroup.make("probe")
    .add(
      HttpApiEndpoint.get("probe", "/probe", { query, success: Schema.String }),
      HttpApiEndpoint.get("slow", "/slow", { query, success: Schema.String }),
      HttpApiEndpoint.get("stream", "/stream", { query, success: Schema.String }),
      HttpApiEndpoint.get("async", "/async", { query, success: Schema.String }),
      HttpApiEndpoint.get("socket", "/socket", { query, success: Schema.String }),
      HttpApiEndpoint.get("error", "/error", { query, success: Schema.String }),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(Routing),
)

const routes = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(
    HttpApiBuilder.group(Api, "probe", (handlers) =>
      Effect.gen(function* () {
        const control = yield* Control
        const scope = yield* Scope.Scope
        const wait = Deferred.succeed(control.started, undefined).pipe(Effect.andThen(Deferred.await(control.finish)))
        return handlers
          .handle("probe", () => InstanceRef.pipe(Effect.map((ctx) => ctx?.directory ?? "missing")))
          .handleRaw("slow", () => wait.pipe(Effect.as(HttpServerResponse.text("finished"))))
          .handleRaw("stream", () =>
            Effect.succeed(
              HttpServerResponse.stream(
                Stream.concat(Stream.make("open"), Stream.fromEffect(wait.pipe(Effect.as("finished")))).pipe(
                  Stream.encodeText,
                ),
              ),
            ),
          )
          .handleRaw("async", () =>
            OwnerQuiescence.fork(wait, scope, true).pipe(Effect.as(HttpServerResponse.empty({ status: 204 }))),
          )
          .handleRaw("socket", ({ request }) =>
            Effect.gen(function* () {
              const socket = yield* request.upgrade.pipe(Effect.orDie)
              yield* Deferred.succeed(control.started, undefined)
              yield* socket.runRaw(() => Effect.void).pipe(Effect.ignore)
              return HttpServerResponse.empty()
            }),
          )
          .handleRaw("error", () => Effect.die(new Error("fixture handler failure")))
      }),
    ),
  ),
  Layer.provide([instanceContextLayer, routing]),
)

const it = testEffect(
  Layer.mergeAll(
    NodeHttpServer.layerTest,
    NodeServices.layer,
    control,
    LayerNode.compile(LayerNode.group([InstanceStore.node, CrossSpawnSpawner.node]), [
      [InstanceStore.bootstrapNode, Layer.succeed(InstanceBootstrap.Service, { run: Effect.void })],
    ]),
  ),
)

const serve = (timeout: number | undefined) =>
  routes.pipe(Layer.provide(Layer.succeed(InstanceIdleTimeout, timeout)), HttpRouter.serve, Layer.build)

const disposal = (directory: string) =>
  Effect.gen(function* () {
    const calls: string[] = []
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        registerDisposer(async (input) => {
          if (input === directory) calls.push(input)
        }),
      ),
      (off) => Effect.sync(off),
    )
    return {
      calls,
      wait: pollWithTimeout(
        Effect.sync(() => calls.length || undefined),
        "HTTP instance did not expire",
        "2 seconds",
      ),
    }
  })

it.live("releases a completed HTTP directory after inactivity", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped({ git: true })
    let disposed = 0
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        registerDisposer(async (input) => {
          if (input === directory) disposed++
        }),
      ),
      (off) => Effect.sync(off),
    )
    yield* serve(30)
    const response = yield* HttpClient.get(`/probe?directory=${encodeURIComponent(directory)}`)
    expect(response.status).toBe(200)
    expect(yield* response.json).toBe(directory)
    yield* pollWithTimeout(
      Effect.sync(() => (disposed > 0 ? disposed : undefined)),
      "completed HTTP instance retained past idle timeout",
      "300 millis",
    )
    expect(disposed).toBe(1)
  }),
)

for (const endpoint of ["slow", "async"] as const) {
  it.live(`keeps ${endpoint} work alive beyond the request idle timeout`, () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const events = yield* disposal(directory)
      const control = yield* Control
      yield* serve(30)
      const request = yield* HttpClient.get(`/${endpoint}?directory=${encodeURIComponent(directory)}`).pipe(
        Effect.forkScoped,
      )
      yield* Deferred.await(control.started)
      if (endpoint === "async") expect((yield* Fiber.join(request)).status).toBe(204)
      yield* Effect.sleep(100)
      expect(events.calls).toHaveLength(0)
      yield* Deferred.succeed(control.finish, undefined)
      const response = yield* Fiber.join(request)
      if (endpoint === "slow") expect(yield* response.text).toBe("finished")
      yield* events.wait
    }),
  )
}

for (const ending of ["complete", "cancel"] as const) {
  it.live(`keeps streamed bodies until they ${ending}`, () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const events = yield* disposal(directory)
      const control = yield* Control
      yield* serve(30)
      const response = yield* HttpClient.get(`/stream?directory=${encodeURIComponent(directory)}`)
      const reader = yield* response.stream.pipe(Stream.runDrain, Effect.forkScoped)
      yield* Deferred.await(control.started)
      yield* Effect.sleep(100)
      expect(events.calls).toHaveLength(0)
      if (ending === "complete") {
        yield* Deferred.succeed(control.finish, undefined)
        yield* Fiber.join(reader)
      }
      if (ending === "cancel") yield* Fiber.interrupt(reader)
      yield* events.wait
    }),
  )
}

it.live("keeps a WebSocket instance until the socket closes", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const events = yield* disposal(directory)
    const control = yield* Control
    yield* serve(30)
    const server = yield* HttpServer.HttpServer
    if (server.address._tag !== "TcpAddress") return yield* Effect.die(new Error("missing TCP test listener"))
    const socket = yield* Socket.makeWebSocket(
      `ws://127.0.0.1:${server.address.port}/socket?directory=${encodeURIComponent(directory)}`,
    ).pipe(Effect.provide(Socket.layerWebSocketConstructorGlobal))
    const client = yield* socket.runRaw(() => Effect.void).pipe(Effect.forkScoped)
    yield* Deferred.await(control.started)
    yield* Effect.sleep(100)
    expect(events.calls).toHaveLength(0)
    const write = yield* socket.writer
    yield* write(new Socket.CloseEvent(1000))
    yield* Fiber.await(client)
    yield* events.wait
  }),
)

it.live("releases a failed HTTP handler's lease", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const events = yield* disposal(directory)
    yield* serve(30)
    const response = yield* HttpClient.get(`/error?directory=${encodeURIComponent(directory)}`)
    expect(response.status).toBe(500)
    yield* events.wait
  }),
)

for (const timeout of [undefined, 0]) {
  it.live(`does not enroll private HTTP handlers with idle policy ${timeout}`, () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const events = yield* disposal(directory)
      yield* serve(timeout)
      const response = yield* HttpClient.get(`/probe?directory=${encodeURIComponent(directory)}`)
      expect(response.status).toBe(200)
      yield* response.json
      yield* Effect.sleep(100)
      expect(events.calls).toHaveLength(0)
    }),
  )
}
