import { expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { LLMEvent } from "@opencode-ai/llm"
import { Context, Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { OwnerQuiescence } from "@/owner/quiescence"
import { LLM } from "@/session/llm"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session/session"
import { provideTmpdirServer } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { testProviderConfig } from "../lib/test-provider"

const flags = RuntimeFlags.layer({ pure: true, disableDefaultPlugins: true, experimentalEventSystem: true })
const TitleResponseGate = Context.Reference<{
  readonly received: Deferred.Deferred<Fiber.Fiber<unknown, unknown>>
  readonly release: Deferred.Deferred<void>
} | undefined>("@test/TitleResponseGate", { defaultValue: () => undefined })

// The HTTP fixture auto-replies to title requests. Hold the real response's
// first text delta before handing it to the title worker, whose fiber we join.
const gatedLLM = Layer.effect(
  LLM.Service,
  Effect.gen(function* () {
    const llm = yield* LLM.Service
    return LLM.Service.of({
      stream(input) {
        const response = llm.stream(input)
        if (input.agent.name !== "title") return response
        return Stream.unwrap(
          Effect.withFiber((fiber) =>
            Effect.gen(function* () {
              const gate = yield* TitleResponseGate
              if (!gate) return response
              return response.pipe(
                Stream.tap((event) =>
                  LLMEvent.is.textDelta(event)
                    ? Deferred.succeed(gate.received, fiber).pipe(Effect.andThen(Deferred.await(gate.release)))
                    : Effect.void,
                ),
              )
            }),
          ),
        )
      },
    })
  }),
).pipe(Layer.provide(AppNodeBuilder.build(LLM.node, [[RuntimeFlags.node, flags]])))

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      SessionPrompt.node,
      Session.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
    ]),
    [[RuntimeFlags.node, flags], [LLM.node, gatedLLM]],
  ),
)

const config = (url: string) => ({ ...testProviderConfig(url), model: "test/test-model", snapshot: false })
const parts = [{ type: "text", text: "Explain how to repair the cache." }] as const

it.live("the first prompt keeps a preset title without calling the title model", () =>
  provideTmpdirServer(
    ({ llm }) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const prompt = yield* SessionPrompt.Service
        const session = yield* sessions.create({ title: "Preset title" })
        yield* llm.text("Main response")

        const result = yield* prompt.prompt({ sessionID: session.id, parts })
        // A prompt can return before its background title work settles.
        yield* pollWithTimeout(
          Effect.sync(() => (OwnerQuiescence.status().active === 0 ? true : undefined)),
          "prompt background work did not settle",
        )

        expect(result.parts.filter((part) => part.type === "text").map((part) => part.text)).toEqual(["Main response"])
        expect(yield* llm.calls).toBe(1)
        expect((yield* sessions.get(session.id)).title).toBe("Preset title")
      }),
    { config },
  ),
)

for (const rename of [false, true]) {
  it.live(
    rename ? "a manual rename wins while the first prompt's title response is held" : "the first prompt names an untitled session",
    () =>
      provideTmpdirServer(
        ({ llm }) =>
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const prompt = yield* SessionPrompt.Service
            const session = yield* sessions.create()
            const received = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>()
            const release = yield* Deferred.make<void>()
            yield* llm.text("Main response")

            const turn = yield* prompt.prompt({ sessionID: session.id, parts }).pipe(
              Effect.provideService(TitleResponseGate, { received, release }),
              Effect.forkChild,
            )
            const worker = yield* awaitWithTimeout(Deferred.await(received), "title response did not reach the gate")
            if (rename) yield* sessions.setTitle({ sessionID: session.id, title: "Manual rename" })
            yield* Deferred.succeed(release, undefined)
            yield* awaitWithTimeout(Fiber.join(worker), "title worker did not settle")

            const result = yield* Fiber.join(turn)
            expect(result.parts.filter((part) => part.type === "text").map((part) => part.text)).toEqual(["Main response"])
            expect(yield* llm.calls).toBe(2)
            expect((yield* sessions.get(session.id)).title).toBe(rename ? "Manual rename" : "E2E Title")
          }),
        { config },
      ),
  )
}
