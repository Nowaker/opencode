import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { LLMEvent } from "@opencode-ai/llm"
import { Effect, Layer, Schema, Stream } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { SessionCompaction } from "@/session/compaction"
import { LLM } from "@/session/llm"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionSummary } from "@/session/summary"
import { isRecord } from "@/util/record"
import { ProviderTest } from "../fake/provider"
import { provideTmpdirInstance } from "../fixture/fixture"

export const records = "\n<records>authoritative</records>"
export const sequences = ["\n## Reserved", "<begin-records>", "<end-records>"]
const model = { providerID: ProviderV2.ID.make("opencode-stop-test"), modelID: ModelV2.ID.make("test-model") }

export function compactionStopCase(options: {
  stream?: Stream.Stream<LLMEvent, unknown>
  sequences?: string[]
  complete?: Effect.Effect<void, unknown>
  completeError?: Error
  append?: (text: string) => string
  afterComplete?: Effect.Effect<void, unknown>
  config?: Partial<ConfigV1.Info>
  native?: boolean
}) {
  const completed: string[] = []
  let requests = 0
  const plugin = Layer.mock(Plugin.Service)({
    trigger: (name, _input, output) =>
      Effect.gen(function* () {
        if (!isRecord(output)) return output
        if (name === "experimental.session.compacting") {
          Object.assign(output, { stopSequences: options.sequences ?? sequences })
        }
        if (name === "experimental.text.complete" && typeof output.text === "string") {
          completed.push(output.text)
          if (options.complete) yield* options.complete.pipe(Effect.orDie)
          if (options.completeError) throw options.completeError
          Object.assign(output, { text: options.append ? options.append(output.text) : output.text + records })
          if (options.afterComplete) yield* options.afterComplete.pipe(Effect.orDie)
        }
        return output
      }),
    list: () => Effect.succeed([]),
    init: () => Effect.void,
  })
  const replacements: LayerNode.Replacements = [
    [Plugin.node, plugin],
    [
      RuntimeFlags.node,
      RuntimeFlags.layer({ experimentalEventSystem: true, experimentalNativeLlm: options.native ?? false }),
    ],
    [SessionSummary.node, Layer.mock(SessionSummary.Service)({ summarize: () => Effect.void })],
  ]
  const stream = options.stream
  const llmOverrides: LayerNode.Replacements = stream
    ? [
        [
          LLM.node,
          Layer.succeed(
            LLM.Service,
            LLM.Service.of({
              stream: () => {
                requests++
                return stream
              },
            }),
          ),
        ],
        [
          Provider.node,
          ProviderTest.fake({ model: ProviderTest.model({ id: model.modelID, providerID: model.providerID }) }).layer,
        ],
      ]
    : []
  const layer = LayerNode.compile(
    LayerNode.group([
      SessionCompaction.node,
      Session.node,
      SessionProjector.node,
      Database.node,
      EventV2Bridge.node,
      CrossSpawnSpawner.node,
    ]),
    [...replacements, ...llmOverrides],
  )
  return provideTmpdirInstance(
    () =>
      Effect.gen(function* () {
      const session = yield* Session.Service
      const events = yield* EventV2Bridge.Service
      const chat = yield* session.create({})
      const original = yield* session.createMessage({
        id: MessageID.ascending(),
        sessionID: chat.id,
        role: "user",
        agent: "build",
        model,
        time: { created: Date.now() },
      })
      yield* session.updatePart({
        id: PartID.ascending(),
        sessionID: chat.id,
        messageID: original.id,
        type: "text",
        text: "source history",
      })
      const compaction = yield* SessionCompaction.Service
      yield* compaction.create({ sessionID: chat.id, agent: "build", model, auto: true })
      const before = yield* session.messages({ sessionID: chat.id })
      const parent = before.at(-1)
      if (!parent) throw new Error("missing compaction marker")
      const deltas: string[] = []
      const seen: string[] = []
      const off = yield* events.listen((event) =>
        Effect.sync(() => {
          seen.push(event.type)
          if (event.type === MessageV2.Event.PartDelta.type) {
            deltas.push(Schema.decodeUnknownSync(MessageV2.Event.PartDelta.data)(event.data).delta)
          }
          if (isRecord(event.data) && isRecord(event.data.status) && event.data.status.type === "retry") seen.push("retry")
        }),
      )
      yield* Effect.addFinalizer(() => off)
      const result = yield* compaction.process({
        sessionID: chat.id,
        parentID: parent.info.id,
        messages: before,
        auto: true,
      })
      const messages = yield* session.messages({ sessionID: chat.id })
      const summary = messages.find((message) => message.info.role === "assistant" && message.info.summary)
      const text = summary?.parts.find((part): part is SessionV1.TextPart => part.type === "text")
      return {
        result,
        messages,
        summary,
        text,
        deltas,
        seen,
        completed,
        requests,
        original,
        filtered: MessageV2.filterCompacted(yield* MessageV2.stream(chat.id)),
      }
      }),
    { config: { compaction: { tail_turns: 0 }, ...options.config } },
  ).pipe(Effect.provide(layer))
}
