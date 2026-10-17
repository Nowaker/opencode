import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Runner } from "@/effect/runner"
import { BackgroundJob } from "@/background/job"
import { Effect, Latch, Layer, Scope, Context } from "effect"
import { Session } from "./session"
import { SessionID } from "./schema"
import { SessionStatus } from "./status"
import { OwnerQuiescence } from "@/owner/quiescence"
import { observeDisposal } from "@/effect/instance-registry"
import { SessionAbort } from "./abort"

export interface Interface {
  readonly assertNotBusy: (sessionID: SessionID) => Effect.Effect<void, Session.BusyError>
  readonly cancel: (sessionID: SessionID, options?: SessionAbort.CancelOptions) => Effect.Effect<void>
  readonly ensureRunning: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<SessionV1.WithParts>,
    work: Effect.Effect<SessionV1.WithParts>,
  ) => Effect.Effect<SessionV1.WithParts>
  readonly startShell: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<SessionV1.WithParts>,
    work: Effect.Effect<SessionV1.WithParts>,
    ready?: Latch.Latch,
  ) => Effect.Effect<SessionV1.WithParts, Session.BusyError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRunState") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service
    const status = yield* SessionStatus.Service
    const sessions = yield* Session.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionRunState.state")(function* (ctx) {
        const scope = yield* Scope.Scope
        const disposal: SessionAbort.State = {}
        const runners = new Map<SessionID, { runner: Runner.Runner<SessionV1.WithParts>; abort: SessionAbort.State }>()
        const off = observeDisposal((directory, reason) => {
          if (directory !== ctx.directory) return
          disposal.metadata ??= { cause: "dispose", ...(reason ? { dispose: reason } : {}) }
          for (const entry of runners.values()) entry.abort.metadata ??= disposal.metadata
        })
        yield* Effect.addFinalizer(() => Effect.sync(off))
        yield* Effect.addFinalizer(
          Effect.fnUntraced(function* () {
            yield* Effect.forEach(runners.values(), (entry) => entry.runner.cancel, {
              concurrency: "unbounded",
              discard: true,
            })
            runners.clear()
          }),
        )
        return { runners, scope, disposal }
      }),
    )

    const runner = Effect.fn("SessionRunState.runner")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
    ) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (existing) return existing
      let abort: SessionAbort.State = {}
      const next = Runner.make<SessionV1.WithParts>(data.scope, {
        prepare: (work) => {
          abort = { metadata: data.disposal.metadata }
          return work.pipe(Effect.provideService(SessionAbort.Current, abort))
        },
        onIdle: Effect.gen(function* () {
          const current = data.runners.get(sessionID)
          if (current && current.runner !== next) return
          data.runners.delete(sessionID)
          yield* status.set(sessionID, { type: "idle" })
        }),
        onBusy: status.set(sessionID, { type: "busy" }),
        onInterrupt,
      })
      const entry = {
        runner: next,
        get abort() {
          return abort
        },
      }
      data.runners.set(sessionID, entry)
      return entry
    })

    const assertNotBusy = Effect.fn("SessionRunState.assertNotBusy")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (existing?.runner.busy) yield* busyError(sessionID)
    })

    const cancel = Effect.fn("SessionRunState.cancel")(
      function* (sessionID: SessionID, options?: SessionAbort.CancelOptions) {
        const data = yield* InstanceState.get(state)
        const existing = data.runners.get(sessionID)
        yield* Effect.all(
          [
            existing
              ? existing.runner.cancelWith(() => {
                  existing.abort.metadata ??= { cause: "cancel", ...options }
                })
              : Effect.void,
            cancelBackgroundJobs(background, sessionID),
          ],
          { concurrency: "unbounded", discard: true },
        )
        if (!existing && !data.runners.has(sessionID)) yield* status.set(sessionID, { type: "idle" })
      },
      Effect.uninterruptible,
    )

    const ensureRunning = Effect.fn("SessionRunState.ensureRunning")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
      work: Effect.Effect<SessionV1.WithParts>,
    ) {
      const entry = yield* runner(sessionID, onInterrupt)
      return yield* entry.runner.ensureRunning(Effect.andThen(sessions.recordExecution(sessionID), work))
    })

    const startShell = Effect.fn("SessionRunState.startShell")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
      work: Effect.Effect<SessionV1.WithParts>,
      ready?: Latch.Latch,
    ) {
      const entry = yield* runner(sessionID, onInterrupt)
      return yield* entry.runner
        .startShell(Effect.andThen(sessions.recordExecution(sessionID), work), ready)
        .pipe(Effect.catchTag("RunnerBusy", () => Effect.fail(busyError(sessionID))))
    })

    return Service.of({
      assertNotBusy,
      cancel,
      ensureRunning: (...args) => OwnerQuiescence.activity(ensureRunning(...args)),
      startShell: (...args) => OwnerQuiescence.activity(startShell(...args)),
    })
  }),
)

const cancelBackgroundJobs = Effect.fn("SessionRunState.cancelBackgroundJobs")(function* (
  background: BackgroundJob.Interface,
  sessionID: SessionID,
) {
  const jobs = yield* background.list()
  const pending = new Set<string>([sessionID])
  const cancelled = new Set<string>()
  const matches = (job: BackgroundJob.Info) => {
    if (job.status !== "running") return false
    if (cancelled.has(job.id)) return false
    if (pending.has(job.id)) return true
    if (typeof job.metadata?.sessionId === "string" && pending.has(job.metadata.sessionId)) return true
    return typeof job.metadata?.parentSessionId === "string" && pending.has(job.metadata.parentSessionId)
  }
  let batch = jobs.filter(matches)
  while (batch.length > 0) {
    yield* Effect.forEach(
      batch,
      (job) =>
        background.cancel(job.id).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              cancelled.add(job.id)
              pending.add(job.id)
              if (typeof job.metadata?.sessionId === "string") pending.add(job.metadata.sessionId)
            }),
          ),
        ),
      { concurrency: "unbounded", discard: true },
    )
    batch = jobs.filter(matches)
  }
})

function busyError(sessionID: SessionID) {
  return new Session.BusyError({ sessionID })
}

export const node = LayerNode.make({ service: Service, layer: layer, deps: [BackgroundJob.node, SessionStatus.node, Session.node] })

export * as SessionRunState from "./run-state"
