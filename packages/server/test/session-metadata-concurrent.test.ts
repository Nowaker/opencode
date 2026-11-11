import { expect } from "bun:test"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import path from "node:path"
import { isolatedEnv } from "../../cli/test/fixture/environment"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"

const Ready = Schema.Struct({ url: Schema.String, pid: Schema.Number })
const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })

it.live(
  "preserves disjoint metadata from two engines and a child session writing its parent concurrently",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const start = () =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const ready = Promise.withResolvers<typeof Ready.Type>()
            const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixture/metadata-server.ts")], {
              cwd: tmp.path,
              env: isolatedEnv(tmp.path, {
                OPENCODE_DB: path.join(tmp.path, "metadata.db"),
                OPENCODE_DISABLE_PROJECT_CONFIG: "1",
                OPENCODE_CONFIG_PROJECT_DISABLE: "1",
                OPENCODE_DISABLE_CLAUDE_CODE: "1",
                OPENCODE_DISABLE_FFF: "1",
                OPENCODE_TOOLS_DATA_DIR: path.join(tmp.path, "tools"),
                OPENCODE_PLUGINS_DATA_DIR: path.join(tmp.path, "plugins"),
                TMPDIR: tmp.path,
                TMP: tmp.path,
                TEMP: tmp.path,
              }),
              stdin: "pipe",
              stdout: "ignore",
              stderr: "pipe",
              ipc: (message) => ready.resolve(Schema.decodeUnknownSync(Ready)(message)),
              onExit: (_, code) => ready.reject(new Error(`metadata server exited before readiness (${code})`)),
            })
            return { child, ready: ready.promise, errors: new Response(child.stderr).text() }
          }),
          (engine) =>
            Effect.promise(async () => {
              engine.child.stdin.end()
              const code = await engine.child.exited
              const errors = await engine.errors
              expect({ code, errors: code === 0 ? "" : errors }).toEqual({ code: 0, errors: "" })
            }),
        )
      const firstEngine = yield* start()
      const first = yield* Effect.promise(() => firstEngine.ready)
      const secondEngine = yield* start()
      const second = yield* Effect.promise(() => secondEngine.ready)
      expect(first.pid).not.toBe(second.pid)
      const request = (base: string, route: string, init: RequestInit = {}) =>
        fetch(new URL(route, base), { ...init, signal: AbortSignal.timeout(10_000) })
      const create = (base: string, body: unknown) =>
        Effect.promise(async () => {
          const response = await request(base, "/api/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          })
          expect(response.status).toBe(200)
          return Schema.decodeUnknownSync(SessionResponse)(await response.json()).data
        })
      const initial = {
        untouched: { retained: true },
        firstWriter: { retained: "first" },
        secondWriter: { retained: "second" },
        childSession: { retained: "child" },
      }
      const parent = yield* create(first.url, { title: "Concurrent parent", metadata: initial })
      const child = yield* create(second.url, { title: "Child metadata writer", parentID: parent.id })
      expect(child.parentID).toBe(parent.id)

      for (const round of Array.from({ length: 32 }, (_, index) => index)) {
        const patches = [
          { base: first.url, metadata: { firstWriter: { round } }, sessionID: parent.id },
          { base: second.url, metadata: { secondWriter: { round } }, sessionID: parent.id },
          { base: second.url, metadata: { childSession: { round, sessionID: child.id } }, sessionID: child.id },
        ]
        const responses = yield* Effect.promise(() =>
          Promise.all(
            patches.map((patch) =>
              request(patch.base, `/api/session/${parent.id}`, {
                method: "PATCH",
                headers: { "content-type": "application/json", "x-opencode-session-id": patch.sessionID },
                body: JSON.stringify({ metadata: patch.metadata, experimental: { metadataMode: "merge" } }),
              }),
            ),
          ),
        )
        expect(responses.map((response) => response.status)).toEqual([204, 204, 204])
        const response = yield* Effect.promise(() =>
          request(round % 2 === 0 ? first.url : second.url, `/api/session/${parent.id}`),
        )
        expect(response.status).toBe(200)
        const stored = Schema.decodeUnknownSync(SessionResponse)(yield* Effect.promise(() => response.json())).data
        expect(stored.metadata).toEqual({
          ...initial,
          firstWriter: { ...initial.firstWriter, round },
          secondWriter: { ...initial.secondWriter, round },
          childSession: { ...initial.childSession, round, sessionID: child.id },
        })
      }
    }),
  // Two independent production engine boots import the complete server graph.
  { timeout: 30_000 },
)
