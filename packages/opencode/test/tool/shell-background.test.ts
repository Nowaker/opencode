import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Shell } from "@opencode-ai/core/shell"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import type { Event } from "@opencode-ai/schema/event"
import { ShellBackgroundEvent } from "@opencode-ai/schema/shell-background-event"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { ChildProcessSpawner, make as makeSpawner } from "effect/unstable/process/ChildProcessSpawner"
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
import { ShellHandoff } from "../../src/tool/shell/handoff"
import { InstanceState } from "@/effect/instance-state"
import path from "node:path"
import { provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"

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

const runShell = Effect.fn("ShellBackgroundTest.run")(function* (
  args: Tool.InferParameters<typeof ShellTool>,
  context: Tool.Context = ctx,
) {
  const info = yield* ShellTool
  const tool = yield* info.init()
  return yield* tool.execute(args, context)
})

Shell.acceptable.reset()

describe.skipIf(process.platform === "win32")("tool.shell background", () => {
  it.live(
    "hands off the same foreground job and PID, including output on both sides of a duplicate request",
    () =>
      inProject(
        { shell: "/bin/bash" },
        Effect.gen(function* () {
          const dir = yield* InstanceState.directory
          const seen = yield* watch()
          const running = yield* Deferred.make<{ jobID: string; pid: number }>()
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, "gate.sh"),
              `printf 'before:%s\\n' "$$"\nwhile test ! -f release; do sleep 0.02; done\nprintf 'after:%s\\n' "$$"\nexit 3\n`,
            ),
          )
          const tool = yield* ShellTool.pipe(Effect.flatMap((info) => info.init()))
          const call = yield* tool
            .execute(
              { command: "bash gate.sh", timeout: 10_000 },
              {
                ...ctx,
                metadata: (value: Parameters<Tool.Context["metadata"]>[0]) =>
                  Effect.gen(function* () {
                    const id = value.metadata?.foregroundJobID
                    const output = value.metadata?.output
                    if (typeof id !== "string" || typeof output !== "string") return
                    const match = /before:(\d+)\n/.exec(output)
                    if (match) yield* Deferred.succeed(running, { jobID: id, pid: Number(match[1]) })
                  }),
              },
            )
            .pipe(Effect.forkScoped({ startImmediately: true }))
          const before = yield* awaitWithTimeout(
            Effect.raceFirst(
              Deferred.await(running),
              Fiber.join(call).pipe(Effect.flatMap(() => Effect.die(new Error("Bash returned before handoff")))),
            ),
            "PID did not reach live foreground preview",
            "5 seconds",
          )
          const target = {
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            callID: "call_test",
            jobID: before.jobID,
          }
          expect(yield* ShellHandoff.find({ ...target, callID: "call_sibling" })).toBeUndefined()
          expect(yield* ShellHandoff.find({ ...target, sessionID: "ses_other" })).toBeUndefined()
          const control = yield* ShellHandoff.find(target)
          if (!control) throw new Error("running shell transport did not offer handoff")
          const receipts = yield* awaitWithTimeout(
            Effect.all([control.move(), control.move()], { concurrency: "unbounded" }),
            "handoff receipts did not settle",
            "5 seconds",
          )
          const result = yield* awaitWithTimeout(
            Fiber.join(call),
            "Bash call did not return after handoff",
            "5 seconds",
          )
          const started = yield* seen.started
          expect(receipts).toEqual([before.jobID, before.jobID])
          expect(started).toMatchObject({ id: before.jobID, reason: "user" })
          expect(result.metadata).toMatchObject({ jobId: before.jobID, outputPath: started.outputPath })
          expect(() => process.kill(before.pid, 0)).not.toThrow()
          yield* Effect.promise(() => Bun.write(path.join(dir, "release"), "go"))
          const exited = yield* seen.exited
          expect(exited).toMatchObject({
            id: before.jobID,
            exitCode: 3,
            status: "failed",
            outputPath: started.outputPath,
          })
          const saved = yield* Effect.promise(() => Bun.file(started.outputPath).text())
          expect(saved).toBe(`before:${before.pid}\nafter:${before.pid}\n`)
          const background = yield* BackgroundJob.Service
          yield* background.wait({ id: before.jobID })
          expect(yield* ShellHandoff.find(target)).toBeUndefined()
          expect(() => process.kill(before.pid, 0)).toThrow()
        }),
      ),
    20_000,
  )

  it.live(
    "returns on a log match without waiting for the command to exit",
    () =>
      inProject(
        {},
        Effect.gen(function* () {
          const dir = yield* InstanceState.directory
          const seen = yield* watch()
          const result = yield* runShell({
            command: "printf 'RE'; printf 'ADY\\n'; while [ ! -f release ]; do sleep 0.02; done",
            run_in_background: true,
            ready: { log: "^READY$", timeout: 5_000 },
          })
          const started = yield* seen.started
          expect(result.metadata).toMatchObject({ jobId: started.id, readiness: "ready", exit: null })
          yield* Effect.promise(() => Bun.write(path.join(dir, "release"), "go"))
          expect(yield* seen.exited).toMatchObject({ id: started.id, exitCode: 0 })
        }),
      ),
    20_000,
  )

  it.live(
    "does not detach when opening the log fails; permission and foreground completion are unchanged",
    () =>
      inProject(
        { shell: "/bin/bash" },
        Effect.gen(function* () {
          const dir = yield* InstanceState.directory
          const truncation = yield* Truncate.Service
          const permission = yield* Deferred.make<void>()
          const grant = yield* Deferred.make<void>()
          const spawned = yield* Deferred.make<string>()
          const jobs = yield* BackgroundJob.Service
          const tool = yield* ShellTool.pipe(
            Effect.flatMap((info) => info.init()),
            Effect.provideService(Truncate.Service, {
              ...truncation,
              write: () => Effect.die(new Error("fixture log unavailable")),
            }),
          )
          const call = yield* tool
            .execute(
              { command: "while test ! -f release; do sleep 0.02; done; printf done", timeout: 15_000 },
              {
                ...ctx,
                ask: () => Deferred.succeed(permission, undefined).pipe(Effect.andThen(Deferred.await(grant))),
                metadata: (value) => {
                  const id = value.metadata?.foregroundJobID
                  return typeof id === "string" ? Deferred.succeed(spawned, id).pipe(Effect.asVoid) : Effect.void
                },
              },
            )
            .pipe(Effect.forkScoped)

          yield* awaitWithTimeout(Deferred.await(permission), "no permission request", "5 seconds")
          expect(yield* jobs.list()).toEqual([])
          yield* Deferred.succeed(grant, undefined)
          const id = yield* awaitWithTimeout(Deferred.await(spawned), "no foreground preview", "5 seconds")
          const control = yield* ShellHandoff.find({
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            callID: "call_test",
            jobID: id,
          })
          if (!control) throw new Error("running Bash call did not offer handoff")

          expect(yield* awaitWithTimeout(control.move(), "no log failure refusal", "5 seconds")).toBeUndefined()
          expect(yield* jobs.get(id)).toMatchObject({ status: "running" })
          expect((yield* jobs.get(id))?.metadata).not.toHaveProperty("background")
          yield* Effect.promise(() => Bun.write(path.join(dir, "release"), "go"))
          const result = yield* awaitWithTimeout(Fiber.join(call), "foreground call did not finish", "5 seconds")
          expect(result.output).toBe("done")
          expect(result.metadata).toMatchObject({ exit: 0 })
        }),
      ),
    25_000,
  )

  it.live(
    "leaves a job running on a readiness deadline, and reports early nonzero exit distinctly",
    () =>
      inProject(
        {},
        Effect.gen(function* () {
          const jobs = yield* BackgroundJob.Service
          const result = yield* runShell({
            command: "sleep 30",
            run_in_background: true,
            ready: { log: "^NO$", timeout: 80 },
          })
          const job = (yield* jobs.list()).find((item) => item.title === "sleep 30")
          expect(result.metadata).toMatchObject({ readiness: "timeout", jobId: job?.id })
          expect(job?.status).toBe("running")
          if (job) yield* jobs.cancel(job.id)
        }),
      ),
    20_000,
  )

  it.live(
    "reports early nonzero exit with no batch when patterns do not match",
    () =>
      inProject(
        {},
        Effect.gen(function* () {
          const seen = yield* watch()
          const result = yield* runShell({
            command: "printf 'NOT READY\\n'; exit 7",
            run_in_background: true,
            ready: { log: "^READY$" },
            notify: ["^ERROR"],
          })
          const exited = yield* seen.exited
          expect(result.metadata).toMatchObject({ jobId: exited.id, readiness: "exited", exit: 7 })
          expect(exited).not.toHaveProperty("finalLines")
        }),
      ),
    20_000,
  )

  it.live(
    "returns only after a real loopback TCP listener answers",
    () =>
      inProject(
        { shell: "/bin/bash" },
        Effect.gen(function* () {
          const connected = yield* Deferred.make<void>()
          const server = yield* Effect.acquireRelease(
            Effect.sync(() =>
              Bun.listen({
                hostname: "127.0.0.1",
                port: 0,
                socket: {
                  open: (socket) => {
                    Deferred.doneUnsafe(connected, Effect.void)
                    socket.end()
                  },
                  data: () => {},
                },
              }),
            ),
            (server) => Effect.sync(() => server.stop(true)),
          )
          const seen = yield* watch()
          const result = yield* runShell({
            command: "sleep 30",
            run_in_background: true,
            ready: { port: server.port, timeout: 5_000 },
          })
          expect(result.metadata).toMatchObject({ readiness: "ready" })
          yield* awaitWithTimeout(Deferred.await(connected), "listener never accepted the probe")
          const started = yield* seen.started
          const jobs = yield* BackgroundJob.Service
          yield* jobs.cancel(started.id)
          expect(yield* seen.exited).toMatchObject({ id: started.id, status: "cancelled" })
        }),
      ),
    20_000,
  )

  it.live(
    "batches only complete matching lines without truncating the background log",
    () =>
      inProject(
        { shell: "/bin/bash" },
        Effect.gen(function* () {
          const dir = yield* InstanceState.directory
          const events = yield* EventV2Bridge.Service
          const lines = yield* Deferred.make<Event.Data<typeof ShellBackgroundEvent.Lines>>()
          const unsubscribe = yield* events.listen((event) => {
            if (event.type !== ShellBackgroundEvent.Lines.type) return Effect.void
            return Deferred.succeed(lines, event.data as Event.Data<typeof ShellBackgroundEvent.Lines>)
          })
          yield* Effect.addFinalizer(() => unsubscribe)
          const seen = yield* watch()
          const result = yield* runShell({
            command:
              "printf 'HIT-first\\r\\nnoise\\n'; for ((i=0; i<55; i++)); do printf 'HIT-many\\n'; done; while test ! -f release; do sleep 0.02; done; printf 'HIT-final'",
            run_in_background: true,
            notify: ["^HIT-"],
          })
          const started = yield* seen.started
          const batch = yield* awaitWithTimeout(Deferred.await(lines), "no running Bash line batch", "5 seconds")
          expect(batch).toMatchObject({
            id: started.id,
            outputPath: started.outputPath,
            sequence: 1,
            lines: ["HIT-first", ...Array<string>(49).fill("HIT-many")],
            suppressed: 6,
          })
          yield* Effect.promise(() => Bun.write(path.join(dir, "release"), "go"))
          const exit = yield* seen.exited
          expect(exit).toMatchObject({
            id: started.id,
            finalLines: { sequence: 2, lines: ["HIT-final"], suppressed: 0 },
          })
          const saved = yield* Effect.promise(() => Bun.file(started.outputPath).text())
          expect(saved).toBe(`HIT-first\r\nnoise\n${"HIT-many\n".repeat(55)}HIT-final`)
          expect(result.metadata).toMatchObject({ jobId: started.id })
        }),
      ),
    20_000,
  )

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
    "#given a process that is slow to spawn #when it exits #then its duration counts from the spawn, not the call",
    () =>
      inProject(
        {},
        Effect.gen(function* () {
          // given
          const seen = yield* watch()
          const spawner = yield* ChildProcessSpawner
          const slowToSpawn = makeSpawner((command) =>
            Effect.sleep("3 seconds").pipe(Effect.andThen(spawner.spawn(command))),
          )

          // when
          yield* runShell({ command: "sleep 0.2; exit 3", run_in_background: true }).pipe(
            Effect.provideService(ChildProcessSpawner, slowToSpawn),
          )
          const started = yield* seen.started
          const exited = yield* seen.exited

          // then
          expect(exited).toMatchObject({ id: started.id, status: "failed", exitCode: 3 })
          expect(exited.durationMs).toBeLessThan(3_000)
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

  /** Records the order of this file's background events, subscribed before the command starts. */
  const watchOrder = Effect.fn("ShellBackgroundTest.watchOrder")(function* () {
    const events = yield* EventV2Bridge.Service
    const order: string[] = []
    const exited = yield* Deferred.make<void>()
    const unsubscribe = yield* events.listen((event) =>
      Effect.gen(function* () {
        if (event.type === ShellBackgroundEvent.Started.type) order.push("started")
        if (event.type === ShellBackgroundEvent.Exited.type) {
          order.push("exited")
          yield* Deferred.succeed(exited, undefined)
        }
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    return { order, exited: Deferred.await(exited).pipe(Effect.timeout("20 seconds")) }
  })

  /** A Truncate whose write is slow, which widens the gap between moving a job to the background and announcing it. */
  const slowWrite = Effect.fn("ShellBackgroundTest.slowWrite")(function* () {
    const trunc = yield* Truncate.Service
    return Truncate.Service.of({
      ...trunc,
      write: (text) => Effect.sleep("3 seconds").pipe(Effect.andThen(trunc.write(text))),
    })
  })

  for (const [name, args] of [
    ["run_in_background", { command: "exit 0", run_in_background: true }],
    ["a foreground timeout", { command: "sleep 1.5; exit 0", timeout: 300 }],
  ] as const) {
    it.live(
      `#given ${name} #when the command exits before its start is announced #then Started is still published before Exited`,
      () =>
        inProject(
          {},
          Effect.gen(function* () {
            // given
            const seen = yield* watchOrder()
            const slow = yield* slowWrite()

            // when
            yield* runShell(args).pipe(Effect.provideService(Truncate.Service, slow))
            yield* seen.exited
            yield* Effect.sleep("200 millis")

            // then
            expect(seen.order).toEqual(["started", "exited"])
          }),
        ),
      30_000,
    )
  }
})
