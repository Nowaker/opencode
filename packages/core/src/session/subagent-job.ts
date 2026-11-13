export * as SubagentJob from "./subagent-job.js"

import { Context, Effect, Layer, Scope } from "effect"
import { Node } from "@opencode/util/effect/app-node"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { Job } from "../job.js"
import { Session } from "../session.js"
import { SubagentCompletion } from "./subagent-completion.js"
import { Database } from "../database/database.js"
import { KeyedMutex } from "../effect/keyed-mutex.js"

type Recovery = Extract<Job.Recovery, { kind: "subagent" }>

export interface Interface {
  admit: <A, E, R>(childSessionID: Recovery["childSessionID"], launch: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  start: (recovery: Recovery) => Effect.Effect<Job.Info>
  background: (recovery: Recovery) => Effect.Effect<void>
  notify: (recovery: Recovery, startedAt: number) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SubagentJob") {}

const make: Effect.Effect<Interface, never, Session.Service | Job.Service | Database.Service | Scope.Scope> = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const jobs = yield* Job.Service
  const db = (yield* Database.Service).db
  const scope = yield* Scope.Scope
  const admissions = yield* KeyedMutex.make<Recovery["childSessionID"]>()
  // Jobs and their completion observers outlive the plugin that launched them.
  // Fork with the global context too, rather than retaining the caller's location.
  const context = yield* Effect.context<never>()
  // One observer per job generation, including continuations of the same child.
  const notifications = new Set<string>()

  const notify = Effect.fn("SubagentJob.notify")(function* (recovery: Recovery, startedAt: number) {
    const current = yield* jobs.get(recovery.childSessionID)
    const canonical = current?.recovery?.kind === "subagent" ? current.recovery : recovery
    const key = current?.notificationID ?? `${recovery.childSessionID}:${startedAt}`
    if (notifications.has(key)) return
    notifications.add(key)
    yield* Effect.gen(function* () {
      const info = (yield* jobs.wait({ id: recovery.childSessionID })).info
      if (current?.notificationID && info?.notificationID !== current.notificationID) {
        const persisted = (yield* jobs.pendingBackground).find((job) => job.notificationID === current.notificationID)
        if (persisted?.recovery.kind === "subagent")
          yield* SubagentCompletion.deliver(sessions, jobs, { ...persisted, recovery: persisted.recovery, db })
        return
      }
      if (info) yield* SubagentCompletion.deliver(sessions, jobs, { ...info, recovery: canonical, db })
    }).pipe(
      Effect.ensuring(Effect.sync(() => notifications.delete(key))),
      // The global context drops the caller's span annotations; delivery is the parent session's work.
      Effect.annotateSpans("session.id", recovery.parentSessionID),
      Effect.forkIn(scope, { startImmediately: true }),
      Effect.setContext(context),
    )
  })

  return Service.of({
    admit: (childSessionID, launch) => admissions.withLock(childSessionID)(launch),
    start: (recovery: Recovery) =>
      jobs
        .start({
          id: recovery.childSessionID,
          type: "subagent",
          title: recovery.description,
          metadata: {},
          recovery,
          ...(recovery.group ? { notificationID: recovery.group.generation } : {}),
          run: Effect.gen(function* () {
            yield* sessions.resume(recovery.childSessionID)
            return yield* SubagentCompletion.read(db, recovery)
          }),
        })
        .pipe(Effect.setContext(context)),
    background: Effect.fn("SubagentJob.background")(function* (recovery: Recovery) {
      const info = yield* jobs.background(recovery.childSessionID)
      if (info) yield* notify(recovery, info.started_at)
    }),
    notify,
  })
})

export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = Node.makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [Session.node, Job.node, Database.node],
})
