// Deep imports: the @effect/platform-node barrel eagerly pulls in undici,
// ioredis, and node:sqlite, which runtimes such as workerd cannot load.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as NodePath from "@effect/platform-node/NodePath"
import { Context, Effect, FileSystem, Layer, Path } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { makeGlobalNode } from "./app-node.js"

export const filesystem = makeGlobalNode({ service: FileSystem.FileSystem, layer: NodeFileSystem.layer, deps: [] })
export const path = makeGlobalNode({ service: Path.Path, layer: NodePath.layer, deps: [] })
// `RequestInfo | URL`, spelled out because not every runtime declares `RequestInfo` globally.
export type Fetch = (input: Request | string | URL, init?: RequestInit) => Promise<Response>
/**
 * The fetch behind `httpClient`, AI SDK providers and remote MCP servers: `fetch` when given, so an embedder can route requests through
 * e.g. a Service Binding, otherwise the `FetchHttpClient.Fetch` in scope when the graph is built.
 */
export const fetchLayer = (fetch?: Fetch) =>
  Layer.effect(
    FetchHttpClient.Fetch,
    Effect.gen(function* () {
      // Bun's `typeof fetch` adds `preconnect`, which nothing here calls.
      return fetch ? (fetch as typeof globalThis.fetch) : yield* FetchHttpClient.Fetch
    }),
  )
export const httpFetch = makeGlobalNode({ service: FetchHttpClient.Fetch, layer: fetchLayer(), deps: [] })

export const NativeFetchInit = Context.Reference<((url: URL, init: RequestInit) => RequestInit) | undefined>(
  "@opencode/HttpClient/NativeFetchInit",
  { defaultValue: () => undefined },
)

// Provided per request, so a caller's context can't swap `httpFetch` for another fetch.
export const httpClient = makeGlobalNode({
  service: HttpClient.HttpClient,
  layer: Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const fetch = yield* FetchHttpClient.Fetch
      const client = yield* HttpClient.HttpClient.pipe(Effect.provide(FetchHttpClient.layer))
      if (fetch !== globalThis.fetch)
        return HttpClient.transformResponse(client, Effect.provideService(FetchHttpClient.Fetch, fetch))

      return HttpClient.transformResponse(client, (send) =>
        Effect.flatMap(NativeFetchInit, (initialize) =>
          send.pipe(
            Effect.provideService(
              FetchHttpClient.Fetch,
              initialize
                ? Object.assign(
                    (input: Request | URL | string, init?: RequestInit) =>
                      fetch(input, input instanceof URL && init !== undefined ? initialize(input, init) : init),
                    { preconnect: fetch.preconnect },
                  )
                : fetch,
            ),
          ),
        ),
      )
    }),
  ),
  deps: [httpFetch],
})

export * as LayerNodePlatform from "./app-node-platform.js"
