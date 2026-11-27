import { expect } from "bun:test"
import { and, asc, eq, gt } from "drizzle-orm"
import { Context, Deferred, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { LLMEvent } from "@opencode-ai/llm"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { EventV2Bridge } from "@/event-v2-bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LLM } from "@/session/llm"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session/session"
import { provideTmpdirServer } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { testProviderConfig } from "../lib/test-provider"

const flags = RuntimeFlags.layer({ pure: true, disableDefaultPlugins: true, experimentalEventSystem: true })
const TitleResponseGate = Context.Reference<
  | {
      readonly received: Deferred.Deferred<Fiber.Fiber<unknown, unknown>>
      readonly release: Deferred.Deferred<void>
    }
  | undefined
>("@test/TitleResponseGate", { defaultValue: () => undefined })

// Hold the first title delta from the existing HTTP fixture and capture the
// worker so even the no-event case can wait for title generation to finish.
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
      EventV2Bridge.node,
      Database.node,
      CrossSpawnSpawner.node,
      LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
    ]),
    [
      [RuntimeFlags.node, flags],
      [LLM.node, gatedLLM],
    ],
  ),
)

const updated = Session.Event.Updated
const decodeUpdate = Schema.decodeUnknownSync(updated.data)
const durable = updated.durable
if (!durable) throw new Error("session updates must be durable")
const durableType = EventV2.versionedType(updated.type, durable.version)
const manualTitle = "Manual rename"

for (const rename of [false, true]) {
  it.live(
    rename
      ? "late generated title preserves the manual rename without an update event"
      : "first prompt generates a title",
    () =>
      provideTmpdirServer(
        () =>
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const prompt = yield* SessionPrompt.Service
            const { db } = yield* Database.Service
            const session = yield* sessions.create()
            const received = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>()
            const release = yield* Deferred.make<void>()

            const turn = yield* prompt
              .prompt({
                sessionID: session.id,
                parts: [{ type: "text", text: "Explain how to repair the cache." }],
              })
              .pipe(Effect.provideService(TitleResponseGate, { received, release }), Effect.forkChild)
            const worker = yield* awaitWithTimeout(Deferred.await(received), "title response did not reach the gate")
            yield* awaitWithTimeout(Fiber.join(turn), "the main response waited for the title worker")
            const before = yield* EventV2.latestSequence(db, session.id)
            const live: string[] = []
            const liveUpdate = Schema.decodeUnknownOption(
              Schema.Struct({
                type: Schema.Literal(updated.type),
                properties: Schema.Struct({ sessionID: Schema.String, info: Schema.Struct({ title: Schema.String }) }),
              }),
            )
            const listener = ({ payload }: GlobalEvent) => {
              const event = liveUpdate(payload)
              if (event._tag === "Some" && event.value.properties.sessionID === session.id)
                live.push(event.value.properties.info.title)
            }
            GlobalBus.on("event", listener)
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                GlobalBus.off("event", listener)
              }),
            )

            if (rename) yield* sessions.setTitle({ sessionID: session.id, title: manualTitle })
            yield* Deferred.succeed(release, undefined)
            yield* awaitWithTimeout(Fiber.join(worker), "title worker did not settle")

            const stored = yield* db
              .select({ data: EventTable.data })
              .from(EventTable)
              .where(
                and(
                  eq(EventTable.aggregate_id, session.id),
                  eq(EventTable.type, durableType),
                  gt(EventTable.seq, before),
                ),
              )
              .orderBy(asc(EventTable.seq))
              .all()
            const title = rename ? manualTitle : "E2E Title"
            expect({
              title: (yield* sessions.get(session.id)).title,
              live,
              durable: stored.map((event) => decodeUpdate(event.data).info.title),
            }).toEqual({ title, live: [title], durable: [title] })
          }),
        { config: (url) => ({ ...testProviderConfig(url), model: "test/test-model", snapshot: false }) },
      ),
    15_000,
  )
}
