import { expect } from "bun:test"
import { join } from "node:path"
import { tool } from "ai"
import { Clock, Deferred, Effect, Fiber, Layer } from "effect"
import z from "zod"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceBootstrap } from "@/project/bootstrap-service"
import { InstanceStore } from "@/project/instance-store"
import { Provider } from "@/provider/provider"
import { SessionProcessor } from "@/session/processor"
import { MessageID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(TestLLMServer.layer, LayerNode.compile(CrossSpawnSpawner.node)))
const root = LayerNode.group([
  Database.node,
  InstanceStore.node,
  Provider.node,
  Session.node,
  SessionProjector.node,
  SessionProcessor.node,
  SessionStatus.node,
])

it.live("keeps a returned tool live through SQLite writer contention and continues after settlement", () =>
  Effect.gen(function* () {
    const llm = yield* TestLLMServer
    const ref = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") }
    const dir = yield* tmpdirScoped({
      config: {
        snapshot: false,
        enabled_providers: [ref.providerID],
        provider: {
          [ref.providerID]: {
            npm: "@ai-sdk/openai-compatible",
            options: { apiKey: "fixture-only", baseURL: llm.url },
            models: { [ref.modelID]: { name: "Test Model", tool_call: true, limit: { context: 100_000, output: 1000 } } },
          },
        },
      },
    })
    const filename = join(dir, "tool-settlement.sqlite")
    const env = LayerNode.compile(root, [
      [Database.node, Database.layerFromPath(filename)],
      [InstanceStore.bootstrapNode, Layer.succeed(InstanceBootstrap.Service, { run: Effect.void })],
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true, pure: true, disableDefaultPlugins: true })],
      [SessionSummary.node, Layer.mock(SessionSummary.Service, { summarize: () => Effect.void })],
    ])

    yield* Effect.gen(function* () {
      const { db } = yield* Database.Service
      // A native busy handler on this thread would also block the lock holder.
      yield* db.run("PRAGMA busy_timeout = 0")
      const { Database: SqliteDatabase } = yield* Effect.promise(() => import("bun:sqlite"))
      const holder = yield* Effect.acquireRelease(
        Effect.sync(() => new SqliteDatabase(filename, { create: false })),
        (holder) => Effect.sync(() => holder.close()),
      )
      const session = yield* Session.Service
      const status = yield* SessionStatus.Service
      const provider = yield* Provider.Service
      const processors = yield* SessionProcessor.Service
      const chat = yield* session.create()
      const user: SessionV1.User = {
        id: MessageID.ascending(), sessionID: chat.id, role: "user",
        agent: "build", model: ref, time: { created: Date.now() },
      }
      yield* session.updateMessage(user)
      const assistant: SessionV1.Assistant = {
        id: MessageID.ascending(), sessionID: chat.id, parentID: user.id,
        role: "assistant", agent: "build", mode: "build", path: { cwd: dir, root: dir },
        ...ref, time: { created: Date.now() }, cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }
      yield* session.updateMessage(assistant)
      const model = yield* provider.getModel(ref.providerID, ref.modelID)
      const handle = yield* processors.create({ assistantMessage: assistant, sessionID: chat.id, model })

      const callID = "call_1"
      const readTool = holder.query<{ readonly id: string; readonly status: string; readonly output: string | null }, [string, string]>(`
        SELECT id, json_extract(data, '$.state.status') AS status,
               json_extract(data, '$.state.output') AS output
        FROM part WHERE message_id = ? AND json_extract(data, '$.callID') = ?
      `)
      const returnTool = Promise.withResolvers<void>()
      const retrying = yield* Deferred.make<void>()
      const unlocked = yield* Deferred.make<void>()
      const clock = yield* Clock.Clock
      let toolRuns = 0
      yield* llm.tool("lookup", { query: "witness" })
      const run = yield* handle.process({
        user, sessionID: chat.id, model,
        agent: { name: "build", mode: "primary", options: {}, permission: [] },
        system: [], messages: [{ role: "user", content: "Run the lookup once" }],
        tools: {
          lookup: tool({
            inputSchema: z.object({ query: z.string() }),
            execute: async (input) => {
              toolRuns++
              await returnTool.promise
              return { output: `result:${input.query}`, title: "Lookup", metadata: {} }
            },
          }),
        },
      }).pipe(
        Effect.provideService(Clock.Clock, {
          currentTimeMillis: clock.currentTimeMillis,
          currentTimeNanos: clock.currentTimeNanos,
          currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe(),
          currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
          // The SDK emits the tool result before the step finish. With snapshots
          // disabled, settlement is the next write after the tool returns.
          sleep: (duration) => Effect.currentSpan.pipe(Effect.matchEffect({
            onFailure: () => clock.sleep(duration),
            onSuccess: (span) => holder.inTransaction && span.name === "Session.updatePart"
              ? Deferred.succeed(retrying, undefined).pipe(Effect.andThen(Deferred.await(unlocked)))
              : clock.sleep(duration),
          })),
        }),
        Effect.forkScoped,
      )
      yield* Effect.addFinalizer(() => Effect.sync(() => returnTool.resolve()))

      const running = yield* pollWithTimeout(Effect.sync(() => {
        const row = readTool.get(assistant.id, callID)
        return row?.status === "running" ? row : undefined
      }), "tool part never reached running on disk")
      yield* Effect.acquireUseRelease(
        Effect.sync(() => holder.exec("BEGIN IMMEDIATE")),
        () => Effect.gen(function* () {
          returnTool.resolve()
          yield* awaitWithTimeout(Deferred.await(retrying), "terminal part write never entered SQLite retry backoff")
          expect(readTool.get(assistant.id, callID)).toEqual(running)
          expect((yield* status.get(chat.id)).type).toBe("busy")
          expect(run.pollUnsafe()).toBeUndefined()
        }),
        () => Effect.sync(() => holder.exec("ROLLBACK")).pipe(Effect.andThen(Deferred.succeed(unlocked, undefined))),
      )

      const result = yield* awaitWithTimeout(Fiber.join(run), "processor did not continue after writer lock release")
      expect(result).toBe("continue")
      expect(handle.message.finish).toBe("tool-calls")
      expect(toolRuns).toBe(1)
      expect(yield* llm.calls).toBe(1)
      expect(readTool.all(assistant.id, callID)).toEqual([
        { id: running.id, status: "completed", output: "result:witness" },
      ])
      // The projection is an upsert; its final row alone cannot rule out an
      // earlier false abort or a duplicate commit of the terminal state.
      const terminal = holder.query<{ readonly status: string }, [string, string, string]>(`
        SELECT json_extract(data, '$.part.state.status') AS status FROM event
        WHERE aggregate_id = ? AND type GLOB ? AND json_extract(data, '$.part.callID') = ?
          AND json_extract(data, '$.part.state.status') IN ('completed', 'error')
      `)
      expect(terminal.all(chat.id, `${SessionV1.Event.PartUpdated.type}.*`, callID)).toEqual([
        { status: "completed" },
      ])
    }).pipe(Effect.scoped, provideInstance(dir), Effect.provide(env))
  }),
)
