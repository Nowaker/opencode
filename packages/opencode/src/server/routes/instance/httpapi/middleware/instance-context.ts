import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"
import { Context, Effect, Layer, Scope } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { WorkspaceRouteContext } from "./workspace-routing"

export const InstanceIdleTimeout = Context.Reference<number | undefined>("~opencode/HttpInstanceIdleTimeout", {
  defaultValue: () => undefined,
})

export class InstanceContextMiddleware extends HttpApiMiddleware.Service<
  InstanceContextMiddleware,
  {
    requires: WorkspaceRouteContext
  }
>()("@opencode/ExperimentalHttpApiInstanceContext") {}

function decode(input: string): string {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function provideInstanceContext<E>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E>,
  store: InstanceStore.Interface,
  idleTimeout: number | undefined,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, WorkspaceRouteContext | Scope.Scope> {
  return Effect.gen(function* () {
    const route = yield* WorkspaceRouteContext
    const input = { directory: decode(route.directory) }
    const ctx = yield* idleTimeout ? store.acquire(input, idleTimeout) : store.load(input)
    return yield* effect.pipe(
      Effect.provideService(InstanceRef, ctx),
      Effect.provideService(WorkspaceRef, route.workspaceID),
    )
  })
}

export const instanceContextLayer = Layer.effect(
  InstanceContextMiddleware,
  Effect.gen(function* () {
    const store = yield* InstanceStore.Service
    const idleTimeout = yield* InstanceIdleTimeout
    return InstanceContextMiddleware.of((effect) => provideInstanceContext(effect, store, idleTimeout))
  }),
)
