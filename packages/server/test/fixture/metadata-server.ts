import { Effect } from "effect"
import { ServerFetch } from "../../src/fetch"

await Effect.runPromise(
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "metadata-concurrency-test" },
      database: { path: process.env.OPENCODE_DB },
      events: { persist: true },
      config: { directory: process.env.OPENCODE_CONFIG_DIR, project: false, claude: false, content: "{}" },
      fs: { filewatcher: false, fff: false },
      models: { fetch: false },
    })
    const server = yield* Effect.acquireRelease(
      Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => handler(request) })),
      (server) => Effect.promise(() => server.stop(true)),
    )
    process.send?.({ url: server.url.href, pid: process.pid })
    yield* Effect.promise(() => new Response(Bun.stdin.stream()).text())
  }).pipe(Effect.scoped),
)
