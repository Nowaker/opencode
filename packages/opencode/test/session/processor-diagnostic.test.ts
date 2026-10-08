import { expect } from "bun:test"
import { Cause, Effect, Layer, Logger, Predicate, Stream } from "effect"
import { LockTimeoutError, SqlError } from "effect/unstable/sql/SqlError"
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors"
import { Database } from "@opencode-ai/core/database/database"
import { TransactionDiagnostic } from "@opencode-ai/core/database/transaction-diagnostic"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { LLM } from "@/session/llm"
import { Session } from "@/session/session"
import { SessionProcessor } from "@/session/processor"
import { MessageID } from "@/session/schema"
import { SessionSummary } from "@/session/summary"
import { SessionStatus } from "@/session/status"
import { Provider } from "@/provider/provider"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { isRecord } from "@/util/record"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const privateText = "private SQL parameter prompt path native text"
const ref = { providerID: ProviderV2.ID.make("fixture"), modelID: ModelV2.ID.make("fixture") }
const config = {
  provider: {
    fixture: {
      npm: "@ai-sdk/openai-compatible",
      models: { fixture: { name: "Fixture", limit: { context: 100000, output: 1000 } } },
    },
  },
}

for (const phase of ["acquire", "body", "finalize", "after_commit", "untracked", "ordinary"] as const) {
  const error = new SqlError({
    reason: new LockTimeoutError({
      operation: "execute",
      message: privateText,
      cause: Object.assign(new Error(privateText), { code: "SQLITE_BUSY", errno: 5 }),
    }),
  })
  const tracked = phase !== "untracked" && phase !== "ordinary"
  if (tracked) TransactionDiagnostic.record(error, { phase, nested: false, attempts: 3, elapsedMs: 17 })
  const failure = phase === "ordinary"
    ? new Error(privateText)
    : new EffectDrizzleQueryError({ query: "private query", params: [privateText], cause: Cause.fail(error) })
  const root = LayerNode.group([SessionProcessor.node, Provider.node, Session.node, SessionStatus.node])
  const env = LayerNode.compile(root, [
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
    [SessionSummary.node, Layer.mock(SessionSummary.Service, { summarize: () => Effect.void })],
    [LLM.node, Layer.mock(LLM.Service, { stream: () => Stream.fail(failure) })],
  ])
  const it = testEffect(env)

  it.instance(`processor halt preserves bounded diagnostics for ${phase} failures`, () => {
    const messages: unknown[] = []
    return Effect.gen(function* () {
      const instance = yield* TestInstance
      const session = yield* Session.Service
      const provider = yield* Provider.Service
      const processors = yield* SessionProcessor.Service
      const status = yield* SessionStatus.Service
      const chat = yield* session.create({})
      const parent: SessionV1.User = {
        id: MessageID.ascending(), sessionID: chat.id, role: "user",
        time: { created: Date.now() }, agent: "build", model: ref,
      }
      yield* session.updateMessage(parent)
      const message: SessionV1.Assistant = {
        id: MessageID.ascending(), sessionID: chat.id, role: "assistant", parentID: parent.id,
        agent: "build", mode: "build", path: { cwd: instance.directory, root: instance.directory },
        cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        providerID: ref.providerID, modelID: ref.modelID, time: { created: Date.now() },
      }
      yield* session.updateMessage(message)
      const model = yield* provider.getModel(ref.providerID, ref.modelID)
      const handle = yield* processors.create({ assistantMessage: message, sessionID: chat.id, model })

      const result = yield* handle.process({
        user: parent, sessionID: chat.id, model,
        agent: { name: "build", mode: "primary", options: {}, permission: [] },
        system: [], messages: [], tools: {},
      }).pipe(Effect.provide(Logger.layer([
        Logger.make<unknown, void>((options) => messages.push(options.message)),
      ])))

      expect(result).toBe("stop")
      expect((yield* status.get(chat.id)).type).toBe("idle")
      expect(handle.message.error?.name).toBe("UnknownError")
      if (tracked) expect(JSON.stringify(handle.message.error)).not.toContain(privateText)
      const logs = messages.filter((entry) => Array.isArray(entry) && entry[0] === "process" && Predicate.hasProperty(entry[1], "error"))
      expect(logs).toHaveLength(1)
      const log = logs[0]
      if (!Array.isArray(log) || !isRecord(log[1])) throw new Error("missing processor failure log")
      if (!tracked) {
        expect(log[1]).not.toHaveProperty("sqlite")
        return
      }
      expect(log[1].sqlite).toEqual({
        phase, nested: false, attempts: 3, elapsedMs: 17, pid: process.pid,
        reason: "LockTimeoutError", operation: "execute", nativeCode: "SQLITE_BUSY", retryAcquisition: true,
      })
      expect(JSON.stringify(log[1].sqlite)).not.toContain(privateText)
      expect(handle.message.error).not.toHaveProperty("sqlite")
    }).pipe(Effect.provide(Database.layerFromPath(":memory:")))
  }, { config })
}
