import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Shell } from "@opencode-ai/core/shell"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import type { Event } from "@opencode-ai/schema/event"
import { ShellBackgroundEvent } from "@opencode-ai/schema/shell-background-event"
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Layer, Stream } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { TestClock } from "effect/testing"
import {
  ChildProcessSpawner,
  ExitCode,
  make as makeSpawner,
  makeHandle,
  type ChildProcessHandle,
} from "effect/unstable/process/ChildProcessSpawner"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { BackgroundJob } from "@/background/job"
import { Server } from "@/server/server"
import { ExperimentalPaths } from "@/server/routes/instance/httpapi/groups/experimental"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { Plugin } from "../../src/plugin"
import { MessageID, SessionID } from "../../src/session/schema"
import { ShellTool } from "../../src/tool/shell"
import { ShellHandoff } from "../../src/tool/shell/handoff"
import { InstanceState } from "@/effect/instance-state"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { awaitWithTimeout, testEffectShared } from "../lib/effect"

const it = testEffectShared(
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

const cancelViaRoute = Effect.fnUntraced(function* (jobID: string, toolResultForSessionID?: SessionID) {
  const directory = yield* InstanceState.directory
  const url = new URL(ExperimentalPaths.backgroundCancel.replace(":jobID", encodeURIComponent(jobID)), "http://localhost")
  url.searchParams.set("directory", directory)
  if (toolResultForSessionID !== undefined) url.searchParams.set("toolResultForSessionID", toolResultForSessionID)
  return yield* Effect.promise(async (signal) => {
    const response = await Server.Default().app.fetch(new Request(url, { method: "POST", signal }))
    expect(response.status).toBe(200)
    const value: unknown = await response.json()
    return value
  })
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
    "returns a foreground Bash error when the child exits without delivering completion",
    () =>
      inProject(
        { shell: "/bin/bash" },
        Effect.gen(function* () {
          const command = "printf 'probe finished\\n'"
          const jobs = yield* BackgroundJob.Service
          // The unpatched tool promotes the stuck job. Cancel that test-owned job on red too.
          yield* Effect.addFinalizer(() =>
            jobs.list().pipe(
              Effect.flatMap((entries) => {
                const job = entries.find((entry) => entry.title === command)
                return job ? jobs.cancel(job.id).pipe(Effect.asVoid) : Effect.void
              }),
            ),
          )

          const spawner = yield* ChildProcessSpawner
          const spawned = yield* Deferred.make<ChildProcessHandle>()
          const subscribed = yield* Deferred.make<void>()
          const clock = yield* TestClock.make()
          const lostCompletion = makeSpawner((command) =>
            spawner.spawn(command).pipe(
              Effect.tap((handle) => Deferred.succeed(spawned, handle)),
              Effect.map((handle) =>
                makeHandle({
                  ...handle,
                  exitCode: Deferred.succeed(subscribed, undefined).pipe(Effect.andThen(Effect.never)),
                }),
              ),
            ),
          )
          const call = yield* runShell({ command, timeout: 1_000 }).pipe(
            Effect.provideService(ChildProcessSpawner, lostCompletion),
            Effect.provideService(Clock.Clock, clock),
            Effect.forkScoped({ startImmediately: true }),
          )

          yield* awaitWithTimeout(
            Effect.gen(function* () {
              const handle = yield* Deferred.await(spawned)
              expect(yield* handle.exitCode).toBe(ExitCode(0))
              expect(yield* handle.isRunning).toBe(false)
              yield* Deferred.await(subscribed)
            }),
            "did not witness a real child exit with Bash completion withheld",
            "3 seconds",
          )
          yield* clock.adjust("2 seconds")
          const outcome = yield* awaitWithTimeout(Fiber.await(call), "foreground Bash did not settle", "3 seconds")

          expect(outcome._tag).toBe("Failure")
          if (Exit.isFailure(outcome)) {
            const message = String(Cause.squash(outcome.cause))
            expect(message).toMatch(/\b(?:exit(?:ed)?|ended|terminated)\b/i)
            expect(message).toMatch(/\b(?:completion|close|status|code|report(?:ed|ing)?)\b/i)
          }
          expect((yield* jobs.list()).some((job) => job.metadata?.background === true)).toBe(false)
        }),
      ),
    10_000,
  )

  it.live(
    "keeps the final Bash output when the child exits before the deadline but the output is still draining",
    () =>
      inProject(
        { shell: "/bin/bash" },
        Effect.gen(function* () {
          const spawner = yield* ChildProcessSpawner
          const exitSeen = yield* Deferred.make<void>()
          const outputHeld = yield* Deferred.make<void>()
          const releaseOutput = yield* Deferred.make<void>()
          yield* Effect.addFinalizer(() => Deferred.succeed(releaseOutput, undefined))
          const clock = yield* TestClock.make()
          const gated = makeSpawner((command) =>
            spawner.spawn(command).pipe(
              Effect.map((handle) =>
                makeHandle({
                  ...handle,
                  exitCode: handle.exitCode.pipe(Effect.tap(() => Deferred.succeed(exitSeen, undefined))),
                  all: handle.all.pipe(
                    Stream.mapEffect((chunk) =>
                      Deferred.succeed(outputHeld, undefined).pipe(
                        Effect.andThen(Deferred.await(releaseOutput)),
                        Effect.as(chunk),
                      ),
                    ),
                  ),
                }),
              ),
            ),
          )
          const call = yield* runShell({ command: "printf 'final output'", timeout: 100 }).pipe(
            Effect.provideService(ChildProcessSpawner, gated),
            Effect.provideService(Clock.Clock, clock),
            Effect.forkScoped({ startImmediately: true }),
          )

          yield* awaitWithTimeout(
            Effect.all([Deferred.await(exitSeen), Deferred.await(outputHeld)], { concurrency: 2 }),
            "did not witness exit with output held",
            "3 seconds",
          )
          yield* clock.adjust("500 millis")
          yield* Deferred.succeed(releaseOutput, undefined)
          const result = yield* awaitWithTimeout(Fiber.join(call), "Bash did not return its drained output", "3 seconds")

          expect(result.metadata.exit).toBe(0)
          expect(result.output).toBe("final output")
        }),
      ),
    10_000,
  )

  it.live(
    "observes a real Bash exit while its first foreground preview write is blocked",
    () =>
      inProject(
        { shell: "/bin/bash" },
        Effect.gen(function* () {
          const spawner = yield* ChildProcessSpawner
          const child = yield* Deferred.make<ChildProcessHandle>()
          const previewStarted = yield* Deferred.make<void>()
          const releasePreview = yield* Deferred.make<void>()
          yield* Effect.addFinalizer(() => Deferred.succeed(releasePreview, undefined))
          const clock = yield* TestClock.make()
          const jobs = yield* BackgroundJob.Service
          const observe = makeSpawner((command) =>
            spawner.spawn(command).pipe(Effect.tap((handle) => Deferred.succeed(child, handle))),
          )
          const call = yield* runShell(
            { command: "printf 'preview backpressure'", timeout: 100 },
            {
              ...ctx,
              metadata: ({ metadata }) =>
                metadata?.foregroundJobID
                  ? Deferred.succeed(previewStarted, undefined).pipe(Effect.andThen(Deferred.await(releasePreview)))
                  : Effect.void,
            },
          ).pipe(
            Effect.provideService(ChildProcessSpawner, observe),
            Effect.provideService(Clock.Clock, clock),
            Effect.forkScoped({ startImmediately: true }),
          )

          yield* awaitWithTimeout(Deferred.await(previewStarted), "foreground preview never attempted a write", "3 seconds")
          const handle = yield* Deferred.await(child)
          expect(yield* awaitWithTimeout(handle.exitCode, "child did not exit", "3 seconds")).toBe(ExitCode(0))
          yield* clock.adjust("500 millis")
          yield* Deferred.succeed(releasePreview, undefined)
          const result = yield* awaitWithTimeout(Fiber.join(call), "Bash did not settle after preview release", "3 seconds")

          expect(result.metadata.exit).toBe(0)
          expect(result.metadata).not.toHaveProperty("background")
          expect(result.output).toBe("preview backpressure")
          const entries = yield* jobs.list()
          expect(entries).toHaveLength(1)
          const [job] = entries
          if (!job) throw new Error("missing foreground job")
          const settled = yield* awaitWithTimeout(jobs.wait({ id: job.id }), "foreground job did not settle", "3 seconds")
          expect(settled.info?.status).toBe("completed")
        }),
      ),
    10_000,
  )

  it.live(
    "fails a foreground Bash call that reaches its deadline without a spawn receipt",
    () =>
      inProject(
        {},
        Effect.gen(function* () {
          const jobs = yield* BackgroundJob.Service
          const entered = yield* Deferred.make<void>()
          const clock = yield* TestClock.make()
          const noSpawn = makeSpawner(() =>
            Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
          )
          const call = yield* runShell({ command: "printf 'no spawn'", timeout: 1_000 }).pipe(
            Effect.provideService(ChildProcessSpawner, noSpawn),
            Effect.provideService(Clock.Clock, clock),
            Effect.forkScoped({ startImmediately: true }),
          )
          yield* awaitWithTimeout(Deferred.await(entered), "Bash never requested a spawn", "3 seconds")
          const [job] = yield* jobs.list()
          if (!job) throw new Error("Bash did not register its foreground job")
          yield* Effect.addFinalizer(() => jobs.cancel(job.id).pipe(Effect.asVoid))
          yield* clock.adjust("2 seconds")
          const outcome = yield* awaitWithTimeout(Fiber.await(call), "Bash did not settle after its deadline", "3 seconds")

          expect(outcome._tag).toBe("Failure")
          expect((yield* jobs.get(job.id))?.status).toBe("cancelled")
          expect((yield* jobs.get(job.id))?.metadata?.background).toBeUndefined()
        }),
      ),
    10_000,
  )

  it.live(
    "returns the operating-system spawn failure as a foreground Bash error",
    () =>
      Effect.gen(function* () {
        const shell = path.join(yield* tmpdirScoped(), "bash")
        // Shell selection checks for a file; the kernel will reject it at spawn.
        yield* Effect.promise(() => writeFile(shell, "#!/bin/sh\n", { mode: 0o600 }))
        yield* inProject(
          { shell },
          Effect.gen(function* () {
            const spawner = yield* ChildProcessSpawner
            const rejected = yield* Deferred.make<PlatformError>()
            const observeSpawn = makeSpawner((command) =>
              spawner.spawn(command).pipe(Effect.tapError((error) => Deferred.succeed(rejected, error))),
            )
            const outcome = yield* awaitWithTimeout(
              runShell({ command: "printf 'unreachable'", timeout: 1_000 }).pipe(
                Effect.provideService(ChildProcessSpawner, observeSpawn),
                Effect.exit,
              ),
              "foreground Bash did not settle after spawn failure",
              "5 seconds",
            )
            const error = yield* awaitWithTimeout(Deferred.await(rejected), "OS spawn rejection was not observed")

            expect(error.reason).toMatchObject({ method: "spawn", cause: { code: "EACCES" } })
            expect(outcome._tag).toBe("Failure")
            if (Exit.isFailure(outcome)) {
              expect(String(Cause.squash(outcome.cause))).toMatch(/permission\s*denied|eacces/i)
            }
          }),
        )
      }),
    10_000,
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
    "publishes an unmarked cancellation for the legacy stop request",
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
          expect(yield* cancelViaRoute(started.id)).toBe(true)
          const exited = yield* seen.exited

          // then
          expect(exited).toMatchObject({ id: started.id, status: "cancelled" })
          expect(exited).not.toHaveProperty("reportedBy")
          expect(exited.durationMs).toBeLessThan(10_000)
        }),
      ),
    30_000,
  )

  it.live(
    "rejects the wrong owner and marks only one winner of duplicate scoped Bash stops",
    () =>
      inProject(
        { shell: "/bin/bash" },
        Effect.gen(function* () {
          const seen = yield* watch()
          const order = yield* watchOrder()
          const result = yield* runShell({
            command: "printf 'STARTED\\n'; sleep 30",
            run_in_background: true,
            ready: { log: "^STARTED$" },
          })
          const started = yield* seen.started
          expect(result.metadata).toMatchObject({ readiness: "ready" })
          expect(started.cancelToolReceipt).toBe(1)
          expect(yield* cancelViaRoute(started.id, SessionID.make("ses_wrong"))).toBe(false)

          const replies = yield* Effect.all(
            [cancelViaRoute(started.id, ctx.sessionID), cancelViaRoute(started.id, ctx.sessionID)],
            { concurrency: "unbounded" },
          )

          expect(replies.filter((reply) => reply === true)).toHaveLength(1)
          expect(replies.filter((reply) => reply === false)).toHaveLength(1)
          expect(yield* seen.exited).toMatchObject({ id: started.id, status: "cancelled", reportedBy: "background_cancel" })
          expect(yield* cancelViaRoute(started.id, ctx.sessionID)).toBe(false)
          expect(order.order).toEqual(["started", "exited"])
        }),
      ),
    25_000,
  )

  it.live("rejects missing jobs and leaves non-Bash jobs to the legacy unscoped stop", () =>
    inProject({}, Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const job = yield* jobs.start({
        type: "task",
        metadata: { background: true, parentSessionId: ctx.sessionID },
        canReportCancellation: Effect.succeed(true),
        run: Effect.never,
      })

      expect(yield* cancelViaRoute("bash_missing", ctx.sessionID)).toBe(false)
      expect(yield* cancelViaRoute("bash_missing")).toBe(false)
      expect(yield* cancelViaRoute(job.id, ctx.sessionID)).toBe(false)
      expect((yield* jobs.get(job.id))?.status).toBe("running")
      expect(yield* cancelViaRoute(job.id)).toBe(true)

      const settled = yield* jobs.get(job.id)
      expect(settled?.status).toBe("cancelled")
      expect(settled).not.toHaveProperty("cancelReportedBy")
    })),
  )

  it.live(
    "does not report a scoped stop before the background process actually starts",
    () =>
      inProject(
        {},
        Effect.gen(function* () {
          const seen = yield* watch()
          const spawner = yield* ChildProcessSpawner
          const spawnAllowed = yield* Deferred.make<void>()
          const gated = makeSpawner((command) => Deferred.await(spawnAllowed).pipe(Effect.andThen(spawner.spawn(command))))
          yield* runShell({ command: "exit 0", run_in_background: true }).pipe(
            Effect.provideService(ChildProcessSpawner, gated),
          )
          const started = yield* seen.started

          expect(yield* cancelViaRoute(started.id, ctx.sessionID)).toBe(false)
          yield* Deferred.succeed(spawnAllowed, undefined)

          const exit = yield* seen.exited
          expect(exit).toMatchObject({ id: started.id, status: "completed", exitCode: 0 })
          expect(exit).not.toHaveProperty("reportedBy")
        }),
      ),
    25_000,
  )

  for (const outcome of [
    { status: "completed", command: "exit 0", timeout: false, exitCode: 0 },
    { status: "failed", command: "exit 7", timeout: false, exitCode: 7 },
    { status: "timeout", command: "sleep 30", timeout: 500, exitCode: undefined },
  ] as const) {
    it.live(
      `refuses a scoped stop after ${outcome.status} wins, before the registry settles`,
      () =>
        inProject(
          { bash_background: { timeout: outcome.timeout } },
          Effect.gen(function* () {
            const seen = yield* watch()
            const jobs = yield* BackgroundJob.Service
            const events = yield* EventV2Bridge.Service
            const entered = yield* Deferred.make<void>()
            const release = yield* Deferred.make<void>()
            // The real process has finished; only the exit publication keeps the registry running.
            const unsubscribe = yield* events.listen((event) =>
              event.type === ShellBackgroundEvent.Exited.type
                ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
                : Effect.void,
            )
            yield* Effect.addFinalizer(() => unsubscribe)
            yield* Effect.gen(function* () {
              yield* runShell({ command: outcome.command, run_in_background: true })
              const started = yield* seen.started
              yield* awaitWithTimeout(Deferred.await(entered), "Bash exit publication did not begin", "10 seconds")
              expect((yield* jobs.get(started.id))?.status).toBe("running")

              const reply = yield* awaitWithTimeout(
                cancelViaRoute(started.id, ctx.sessionID),
                "late stop blocked settlement",
                "5 seconds",
              )
              expect(reply).toBe(false)

              const exit = yield* seen.exited
              expect(exit).toMatchObject({ id: started.id, status: outcome.status })
              expect(exit.exitCode).toBe(outcome.exitCode)
              expect(exit).not.toHaveProperty("reportedBy")
            }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))
          }),
        ),
      25_000,
    )
  }

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
