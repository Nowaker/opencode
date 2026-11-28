import { expect } from "bun:test"
import { join } from "node:path"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Context, Deferred, Effect, Fiber, Layer } from "effect"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session/session"
import { skippedSnapshot } from "@/session/snapshot-gap"
import { Snapshot } from "@/snapshot"
import { isRecord } from "@/util/record"
import { provideTmpdirServer } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { raw, reply, TestLLMServer } from "../lib/llm-server"
import { testProviderConfig } from "../lib/test-provider"

type Capture = ReturnType<Snapshot.Interface["track"]>
type CaptureOverride = (capture: Capture) => Capture
const TrackOverride = Context.Reference<CaptureOverride | undefined>("@test/SnapshotPreflightTrack", {
  defaultValue: () => undefined,
})
const flags = RuntimeFlags.layer({ pure: true, disableDefaultPlugins: true, experimentalEventSystem: true })
const snapshot = Layer.effect(
  Snapshot.Service,
  Effect.gen(function* () {
    const real = yield* Snapshot.Service
    return Snapshot.Service.of({
      ...real,
      track: (sessionID) =>
        Effect.gen(function* () {
          const override = yield* TrackOverride
          const capture = real.track(sessionID)
          return yield* (override ? override(capture) : capture)
        }),
    })
  }),
).pipe(Layer.provide(AppNodeBuilder.build(Snapshot.node, [[RuntimeFlags.node, flags]])))

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      SessionPrompt.node,
      Session.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
    ]),
    [[RuntimeFlags.node, flags], [Snapshot.node, snapshot]],
  ),
)

const config = (url: string) => ({ ...testProviderConfig(url), model: "test/test-model", shell: "bash" })
const emptyCapture = Effect.succeed("")
const command = (label: string) => `echo ${label} >> marks.txt`
const warnsAboutUndo = (text: string) =>
  /\b(?:undo(?:ne)?|revert(?:ed)?|roll(?:ed)? back|rollback)\b/i.test(text) &&
  /\b(?:unavailable|without|cannot|can't|not|no|skip\w*)\b/i.test(text)

const setup = Effect.fnUntraced(function* (input: {
  readonly dir: string
  readonly llm: Context.Service.Shape<typeof TestLLMServer>
}) {
  const sessions = yield* Session.Service
  const prompt = yield* SessionPrompt.Service
  const session = yield* sessions.create({
    title: "Preflight test",
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  })
  const marker = join(input.dir, "marks.txt")
  yield* Effect.promise(() => Bun.write(marker, ""))
  const marks = Effect.promise(() => Bun.file(marker).text())
  const messages = sessions.messages({ sessionID: session.id }).pipe(Effect.orDie)
  const toolParts = messages.pipe(
    Effect.map((items) => items.flatMap((item) => item.parts).filter((part) => part.type === "tool")),
  )
  const toolPart = (label: string) =>
    toolParts.pipe(
      Effect.map((parts) => parts.find((part) => part.tool === "bash" && part.state.input.command === command(label))),
    )
  const waiting = toolParts.pipe(Effect.map((parts) => parts.find((part) =>
    (part.state.status === "pending" || part.state.status === "running") &&
    part.state.metadata?.engine?.phase === "waiting-for-snapshot",
  )))
  const run = Effect.fnUntraced(function* (label: string, override?: CaptureOverride, toolGate?: PromiseLike<void>) {
    const args = { command: command(label), workdir: input.dir }
    const response = reply()
    if (toolGate) response.text("Checking workspace.")
    const item = response.tool("bash", args).item()
    yield* input.llm.push(toolGate && item.type === "sse"
      ? raw({ head: [...item.head, ...item.tail.slice(0, 1)], tail: item.tail.slice(1), wait: toolGate })
      : item)
    yield* prompt
      .prompt({ sessionID: session.id, agent: "build", parts: [{ type: "text", text: `Run ${label}` }] })
      .pipe(Effect.provideService(TrackOverride, override))
  })
  const blocked = Effect.fnUntraced(function* (label: string, failure: Capture) {
    yield* run(label, () => failure)
    expect((yield* toolPart(label))?.state).toMatchObject({
      status: "error",
      error: expect.stringMatching(/snapshot/i),
    })
  })
  return { run, blocked, marks, messages, toolPart, toolParts, waiting, cancel: prompt.cancel(session.id) }
})

for (const failure of [
  { label: "empty capture", capture: emptyCapture },
  { label: "failed capture fiber", capture: Effect.die(new Error("Fixture snapshot failure")) },
]) {
  it.live(`the third consecutive gated preflight dispatches once and reports the undo gap after ${failure.label}`, () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* (input) {
        const fixture = yield* setup(input)
        yield* fixture.blocked("first", failure.capture)
        yield* fixture.blocked("second", failure.capture)
        expect(yield* fixture.marks).toBe("")
        const earlier = new Set((yield* fixture.messages).map((message) => message.info.id))

        // Once the write happens, the store can capture again. That capture
        // must not publish a closing hash or patch for the unprotected step.
        yield* fixture.run("third", (capture) =>
          fixture.marks.pipe(Effect.flatMap((marks) => (marks ? capture : failure.capture))),
        )

        expect(yield* fixture.marks).toBe("third\n")
        const tool = yield* fixture.toolPart("third")
        expect(tool?.state.status).toBe("completed")
        expect(tool && skippedSnapshot(tool)).toBe(true)
        const messages = (yield* fixture.messages).filter((message) => !earlier.has(message.info.id))
        const step = messages.find((message) => message.info.id === tool?.messageID)
        expect(step?.parts.some((part) => part.type === "step-finish")).toBe(true)
        expect(
          step?.parts.filter(
            (part) => part.type === "patch" ||
              ((part.type === "step-start" || part.type === "step-finish") && part.snapshot !== undefined),
          ),
        ).toEqual([])

        const sessionText = messages.flatMap((message) =>
          message.parts.flatMap((part) => {
            if (part.type === "text") return [part.text]
            if (part.type === "tool" && part.state.status === "completed") return [part.state.output]
            return []
          }),
        )
        expect(sessionText.some(warnsAboutUndo)).toBe(true)
        const wire = (yield* input.llm.inputs).at(-1)?.messages
        const modelText = Array.isArray(wire)
          ? wire.flatMap((message: unknown) =>
              isRecord(message) && (message.role === "assistant" || message.role === "tool" || message.role === "user")
                ? [JSON.stringify(message.content ?? "")]
                : [],
            )
          : []
        expect(modelText.some(warnsAboutUndo)).toBe(true)

        yield* fixture.run("fourth", () => failure.capture)
        expect(yield* fixture.marks).toBe("third\nfourth\n")
        const fourth = yield* fixture.toolPart("fourth")
        expect(fourth && skippedSnapshot(fourth)).toBe(true)

        yield* fixture.run("recovered")
        expect(yield* fixture.marks).toBe("third\nfourth\nrecovered\n")
        const recovered = yield* fixture.toolPart("recovered")
        expect(recovered && skippedSnapshot(recovered)).toBe(false)
      }),
      { git: true, config },
    ),
    15_000,
  )
}

it.live("a healthy replacement for a failed initial capture resets the failure streak", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* (input) {
      const fixture = yield* setup(input)
      yield* fixture.blocked("first", emptyCapture)
      yield* fixture.blocked("second", emptyCapture)

      const releaseTool = Promise.withResolvers<void>()
      const initial = yield* Deferred.make<void>()
      const releaseCapture = Deferred.succeed(initial, undefined)
      const prior = new Set((yield* fixture.messages).map((message) => message.info.id))
      let first = true
      const run = yield* fixture.run("healthy", (capture) => {
        if (!first) return capture
        first = false
        return Deferred.await(initial).pipe(Effect.andThen(emptyCapture))
      }, releaseTool.promise).pipe(Effect.forkChild)
      yield* Effect.gen(function* () {
        yield* pollWithTimeout(fixture.messages.pipe(Effect.map((messages) => messages.find((message) =>
          !prior.has(message.info.id) && message.parts.some((part) => part.type === "step-start"),
        ))), "the model never started the step before sending its tool call")
        releaseTool.resolve()
        yield* pollWithTimeout(fixture.waiting, "the tool did not wait for the replacement capture")
        yield* releaseCapture
        yield* Fiber.join(run)
      }).pipe(Effect.ensuring(Effect.sync(() => releaseTool.resolve()).pipe(Effect.andThen(releaseCapture))))
      const healthy = yield* fixture.toolPart("healthy")
      expect(healthy?.state.status).toBe("completed")
      expect(healthy && skippedSnapshot(healthy)).toBe(false)
      const step = (yield* fixture.messages).find((message) => message.info.id === healthy?.messageID)
      expect(step?.parts.filter((part) => part.type === "patch").flatMap((part) => part.files)).toEqual([
        join(input.dir, "marks.txt"),
      ])

      yield* fixture.blocked("fourth", emptyCapture)
      yield* fixture.blocked("fifth", emptyCapture)
      expect(yield* fixture.marks).toBe("healthy\n")
    }),
    { git: true, config },
  ),
  15_000,
)

it.live("disabled snapshots let the first write run without a degraded preflight", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* (input) {
      const fixture = yield* setup(input)
      yield* fixture.run("disabled")

      expect(yield* fixture.marks).toBe("disabled\n")
      const tool = yield* fixture.toolPart("disabled")
      expect(tool?.state.status).toBe("completed")
      expect(tool && skippedSnapshot(tool)).toBe(false)
    }),
    { git: true, config: (url) => ({ ...config(url), snapshot: false }) },
  ),
  15_000,
)

it.live("cancelling the third gated preflight does not dispatch even when its capture fails", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* (input) {
      const fixture = yield* setup(input)
      yield* fixture.blocked("first", emptyCapture)
      yield* fixture.blocked("second", emptyCapture)
      const held = yield* Deferred.make<void>()
      const release = Deferred.succeed(held, undefined)
      const run = yield* fixture
        .run("cancelled", () => Deferred.await(held).pipe(Effect.andThen(emptyCapture)))
        .pipe(Effect.forkChild)

      yield* Effect.gen(function* () {
        const waiting = yield* pollWithTimeout(fixture.waiting, "the third tool never reached snapshot preflight")
        const cancel = yield* fixture.cancel.pipe(Effect.forkChild)
        yield* pollWithTimeout(
          fixture.toolParts.pipe(
            Effect.map((parts) => parts.find((part) => part.id === waiting.id && part.state.status === "error")),
          ),
          "cancellation did not reach the tool while capture was held",
        )
        yield* release
        yield* Fiber.join(cancel)
        yield* Fiber.await(run)

        expect(yield* fixture.marks).toBe("")
        const tool = (yield* fixture.toolParts).find((part) => part.id === waiting.id)
        expect(tool?.state.status).toBe("error")
        expect(tool && skippedSnapshot(tool)).toBe(false)
      }).pipe(Effect.ensuring(release))
    }),
    { git: true, config },
  ),
  15_000,
)
