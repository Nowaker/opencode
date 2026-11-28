import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Context, Deferred, Effect, Layer } from "effect"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { OwnerQuiescence } from "@/owner/quiescence"
import { LiveEvents } from "@/session/live-events"
import { SessionPause } from "@/session/pause"
import { SessionProcessor } from "@/session/processor"
import { SessionPrompt } from "@/session/prompt"
import { MessageID, type SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { provideTmpdirServer } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { testProviderConfig } from "../lib/test-provider"

const flags = RuntimeFlags.layer({ pure: true, disableDefaultPlugins: true, experimentalEventSystem: true })

export const FinalReadGate = Context.Reference<{
  readonly sessionID: SessionID
  readonly reached: Deferred.Deferred<void>
  readonly release: Deferred.Deferred<void>
} | undefined>("@test/ApprovedActionFinalReadGate", { defaultValue: () => undefined })

const processorWithFinalReadGate = Layer.effect(
  SessionProcessor.Service,
  Effect.gen(function* () {
    const processor = yield* SessionProcessor.Service
    return SessionProcessor.Service.of({
      ...processor,
      settle: (sessionID) =>
        Effect.gen(function* () {
          const gate = yield* FinalReadGate
          if (gate?.sessionID === sessionID && (yield* Deferred.succeed(gate.reached, undefined))) {
            yield* Deferred.await(gate.release)
          }
          yield* processor.settle(sessionID)
        }),
    })
  }),
).pipe(Layer.provide(AppNodeBuilder.build(SessionProcessor.node, [[RuntimeFlags.node, flags]])))

export const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2Bridge.node,
      LiveEvents.node,
      SessionPrompt.node,
      Session.node,
      SessionPause.node,
      SessionStatus.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
    ]),
    [[RuntimeFlags.node, flags], [SessionProcessor.node, processorWithFinalReadGate]],
  ),
)

export const withSession = <A, E, R>(
  use: (input: {
    readonly llm: TestLLMServer["Service"]
    readonly sessionID: SessionID
    readonly dir: string
  }) => Effect.Effect<A, E, R>,
  options?: { readonly queuedPrompts?: "turn_end"; readonly defaultTitle?: boolean },
) =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const chat = yield* sessions.create(options?.defaultTitle ? undefined : { title: "Receipt fixture" })
        return yield* use({ dir, llm, sessionID: chat.id })
      }),
    {
      config: (url) => ({
        ...testProviderConfig(url),
        model: "test/test-model",
        snapshot: false,
        ...(options?.queuedPrompts && { queued_prompts: options.queuedPrompts }),
      }),
    },
  )

export function observedOrder(body: Record<string, unknown> | undefined, markers: readonly string[]) {
  const messages = body?.messages
  if (!Array.isArray(messages)) throw new Error("fixture did not capture provider messages")
  const text = JSON.stringify(messages)
  return markers
    .flatMap((marker) => {
      const hits: { readonly index: number; readonly marker: string }[] = []
      for (let index = text.indexOf(marker); index !== -1; index = text.indexOf(marker, index + marker.length)) {
        hits.push({ index, marker })
      }
      return hits
    })
    .sort((a, b) => a.index - b.index)
    .map((hit) => hit.marker)
}

export const human = (sessionID: SessionID, text: string) => ({
  sessionID,
  messageID: MessageID.ascending(),
  agent: "build",
  parts: [{ type: "text", text }] as const,
})

export const admitHuman = Effect.fnUntraced(function* (input: ReturnType<typeof human>) {
  const prompt = yield* SessionPrompt.Service
  const admitted = yield* Deferred.make<void, SessionPrompt.AdmissionError>()
  const turn = yield* prompt.prompt(input, admitted).pipe(Effect.forkChild)
  yield* awaitWithTimeout(Deferred.await(admitted), "human prompt was not committed")
  return turn
})

export const ownerIdle = pollWithTimeout(
  Effect.sync(() => (OwnerQuiescence.status().active === 0 ? true : undefined)),
  "the fixture runner did not drain",
)
