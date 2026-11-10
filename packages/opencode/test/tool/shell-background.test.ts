import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Shell } from "@opencode-ai/core/shell"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import type { Event } from "@opencode-ai/schema/event"
import { ShellBackgroundEvent } from "@opencode-ai/schema/shell-background-event"
import { Deferred, Effect, Layer } from "effect"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { BackgroundJob } from "@/background/job"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { Plugin } from "../../src/plugin"
import { MessageID, SessionID } from "../../src/session/schema"
import { ShellTool } from "../../src/tool/shell"
import { provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    LayerNode.compile(
      LayerNode.group([
        CrossSpawnSpawner.node,
        FSUtil.node,
        Plugin.node,
        Truncate.node,
        Config.node,
        Agent.node,
        RuntimeFlags.node,
        BackgroundJob.node,
        EventV2Bridge.node,
      ]),
    ),
    testInstanceStoreLayer,
  ),
)

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "call_test",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

type Started = Event.Data<typeof ShellBackgroundEvent.Started>
type Exited = Event.Data<typeof ShellBackgroundEvent.Exited>

/** Subscribes before the command starts, so neither event can be missed; each resolves on its first match. */
const watch = Effect.fn("ShellBackgroundTest.watch")(function* () {
  const events = yield* EventV2Bridge.Service
  const started = yield* Deferred.make<Started>()
  const exited = yield* Deferred.make<Exited>()
  const unsubscribe = yield* events.listen((event) =>
    Effect.gen(function* () {
      if (event.type === ShellBackgroundEvent.Started.type) yield* Deferred.succeed(started, event.data as Started)
      if (event.type === ShellBackgroundEvent.Exited.type) yield* Deferred.succeed(exited, event.data as Exited)
    }),
  )
  yield* Effect.addFinalizer(() => unsubscribe)
  return {
    started: Deferred.await(started).pipe(Effect.timeout("10 seconds")),
    exited: Deferred.await(exited).pipe(Effect.timeout("20 seconds")),
  }
})

const inProject = <A, E, R>(config: Partial<ConfigV1.Info>, self: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped({ config })
    return yield* self.pipe(provideInstance(dir))
  })

const runShell = Effect.fn("ShellBackgroundTest.run")(function* (args: Tool.InferParameters<typeof ShellTool>) {
  const info = yield* ShellTool
  const tool = yield* info.init()
  return yield* tool.execute(args, ctx)
})

Shell.acceptable.reset()

describe.skipIf(process.platform === "win32")("tool.shell background", () => {
  it.live(
    "#given run_in_background #when the command exits #then the call returned at once and the exit event carries its output",
    () =>
      inProject(
        {},
        Effect.gen(function* () {
          // given
          const seen = yield* watch()

          // when
          const result = yield* runShell({ command: "echo first; sleep 1; echo second", run_in_background: true })
          const started = yield* seen.started
          const exited = yield* seen.exited

          // then
          expect(result.output).toContain(`Command running in background with ID: ${started.id}`)
          expect(result.metadata).toMatchObject({ background: true, jobId: started.id, outputPath: started.outputPath })
          expect(started).toMatchObject({ sessionID: ctx.sessionID, callID: "call_test", reason: "requested" })
          expect(started.timeoutMs).toBe(30 * 60 * 1000)
          expect(exited).toMatchObject({ id: started.id, status: "completed", exitCode: 0 })
          expect(exited.output).toContain("second")
          const saved = yield* (yield* FSUtil.Service).readFileString(started.outputPath)
          expect(saved).toBe("first\nsecond\n")
        }),
      ),
    30_000,
  )

  it.live(
    "#given a foreground command still running at its timeout #when it times out #then it moves to the background and still reports its exit",
    () =>
      inProject(
        {},
        Effect.gen(function* () {
          // given
          const seen = yield* watch()

          // when
          const result = yield* runShell({ command: "echo before; sleep 2; echo after; exit 3", timeout: 300 })
          const started = yield* seen.started
          const exited = yield* seen.exited

          // then
          expect(result.output).toContain("before")
          expect(result.output).toContain(`moved to the background as ${started.id}`)
          expect(result.metadata).toMatchObject({ background: true, jobId: started.id, exit: null })
          expect(started.reason).toBe("timeout")
          expect(exited).toMatchObject({ id: started.id, status: "failed", exitCode: 3 })
          expect(exited.output).toContain("after")
        }),
      ),
    30_000,
  )

  it.live(
    "#given on_timeout kill #when a foreground command times out #then it is stopped as before",
    () =>
      inProject(
        { bash_background: { on_timeout: "kill" } },
        Effect.gen(function* () {
          // when
          const result = yield* runShell({ command: "echo before; sleep 5", timeout: 300 })

          // then
          expect(result.output).toContain("shell tool terminated command after exceeding timeout 300 ms")
          expect(result.metadata).not.toHaveProperty("background")
        }),
      ),
    30_000,
  )

  it.live(
    "#given a bare sleep #when it times out #then it is stopped, not moved",
    () =>
      inProject(
        {},
        Effect.gen(function* () {
          // when
          const result = yield* runShell({ command: "sleep 5", timeout: 300 })

          // then
          expect(result.output).toContain("shell tool terminated command after exceeding timeout 300 ms")
        }),
      ),
    30_000,
  )

  it.live(
    "#given a background limit #when a background command outlives it #then it is stopped and reported as timed out",
    () =>
      inProject(
        { bash_background: { timeout: 500 } },
        Effect.gen(function* () {
          // given
          const seen = yield* watch()

          // when
          yield* runShell({ command: "echo started; sleep 30", run_in_background: true })
          const started = yield* seen.started
          const exited = yield* seen.exited

          // then
          expect(started.timeoutMs).toBe(500)
          expect(exited).toMatchObject({ id: started.id, status: "timeout" })
          expect(exited.durationMs).toBeLessThan(10_000)
        }),
      ),
    30_000,
  )

  it.live(
    "#given a background command #when its job is cancelled #then it is stopped and reported as cancelled",
    () =>
      inProject(
        { bash_background: { timeout: false } },
        Effect.gen(function* () {
          // given
          const seen = yield* watch()
          yield* runShell({ command: "sleep 30", run_in_background: true })
          const started = yield* seen.started
          expect(started.timeoutMs).toBeNull()

          // when
          yield* (yield* BackgroundJob.Service).cancel(started.id)
          const exited = yield* seen.exited

          // then
          expect(exited).toMatchObject({ id: started.id, status: "cancelled" })
          expect(exited.durationMs).toBeLessThan(10_000)
        }),
      ),
    30_000,
  )
})
