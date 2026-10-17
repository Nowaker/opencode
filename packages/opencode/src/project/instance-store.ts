import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { OwnerQuiescence } from "@/owner/quiescence"
import { makeGlobalNode, Node } from "@opencode-ai/core/effect/app-node"
import { GlobalBus } from "@/bus/global"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { InstanceRef } from "@/effect/instance-ref"
import { disposeInstance as runDisposers } from "@/effect/instance-registry"
import type { DisposeReason } from "@/effect/instance-registry"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Context, Deferred, Duration, Effect, Exit, Layer, Scope } from "effect"
import { type InstanceContext } from "./instance-context"
import { InstanceBootstrap } from "./bootstrap-service"
import { InstanceActivity } from "./instance-activity"
import * as Project from "./project"

export interface LoadInput {
  directory: string
  worktree?: string
  project?: Project.Info
}

export interface Interface {
  readonly load: (input: LoadInput) => Effect.Effect<InstanceContext>
  readonly acquire: (input: LoadInput, idleTimeout: number) => Effect.Effect<InstanceContext, never, Scope.Scope>
  readonly reload: (input: LoadInput) => Effect.Effect<InstanceContext>
  readonly dispose: (ctx: InstanceContext, reason?: DisposeReason) => Effect.Effect<void>
  readonly disposeDirectory: (directory: string, reason?: DisposeReason) => Effect.Effect<void>
  readonly disposeAll: (reason?: DisposeReason) => Effect.Effect<void>
  readonly provide: <A, E, R>(input: LoadInput, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/InstanceStore") {}

export const use = serviceUse(Service)

type Entry = InstanceActivity.Entry

const layer: Layer.Layer<Service, never, Project.Service | InstanceBootstrap.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const project = yield* Project.Service
    const bootstrap = yield* InstanceBootstrap.Service
    const scope = yield* Scope.Scope
    const cache = new Map<string, Entry>()

    const boot = (input: LoadInput & { directory: string }, entry: Entry) =>
      Effect.gen(function* () {
        const ctx: InstanceContext =
          input.project && input.worktree
            ? {
                directory: input.directory,
                worktree: input.worktree,
                project: input.project,
              }
            : yield* project.fromDirectory(input.directory).pipe(
                Effect.map((result) => ({
                  directory: input.directory,
                  worktree: result.sandbox,
                  project: result.project,
                })),
              )
        InstanceActivity.register(ctx, entry.activity)
        yield* bootstrap.run.pipe(Effect.provideService(InstanceRef, ctx))
        return ctx
      }).pipe(Effect.withSpan("InstanceStore.boot"))

    const removeEntry = (directory: string, entry: Entry) =>
      Effect.sync(() => {
        if (cache.get(directory) !== entry) return false
        cache.delete(directory)
        entry.activity.retired = true
        InstanceActivity.notify(entry.activity)
        return true
      })

    const completeLoad = (directory: string, input: LoadInput, entry: Entry) =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(boot({ ...input, directory }, entry))
        if (Exit.isFailure(exit)) {
          yield* Effect.promise(() => OwnerQuiescence.cleanupPromise(() => runDisposers(directory)))
          yield* removeEntry(directory, entry)
        }
        yield* Deferred.done(entry.deferred, exit).pipe(Effect.asVoid)
      })

    const emitDisposed = (input: { directory: string; project?: string }) =>
      Effect.sync(() =>
        GlobalBus.emit("event", {
          directory: input.directory,
          project: input.project,
          workspace: WorkspaceContext.workspaceID,
          payload: {
            type: "server.instance.disposed",
            properties: {
              directory: input.directory,
            },
          },
        }),
      )

    const disposeContext = Effect.fn("InstanceStore.disposeContext")(function* (ctx: InstanceContext, reason?: DisposeReason) {
      yield* Effect.logInfo("disposing instance", { directory: ctx.directory })
      yield* Effect.promise(() => OwnerQuiescence.cleanupPromise(() => runDisposers(ctx.directory, reason)))
      yield* emitDisposed({ directory: ctx.directory, project: ctx.project.id })
    })

    const disposeEntry = Effect.fnUntraced(function* (
      entry: Entry,
      ctx: InstanceContext,
      revision?: number,
      reason?: DisposeReason,
    ) {
      const directory = ctx.directory
      if (cache.get(directory) !== entry) return false
      if (entry.disposing) return yield* Deferred.await(entry.disposing).pipe(Effect.as(false))
      if (
        revision !== undefined &&
        (entry.activity.revision !== revision || entry.activity.active || entry.activity.pinned)
      )
        return false
      const done = Deferred.makeUnsafe<void>()
      entry.disposing = done
      entry.activity.retired = true
      InstanceActivity.notify(entry.activity)
      return yield* disposeContext(ctx, reason).pipe(
        Effect.andThen(removeEntry(directory, entry)),
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            if (Exit.isFailure(exit)) {
              entry.activity.retired = false
              InstanceActivity.notify(entry.activity)
            }
            entry.disposing = undefined
            yield* Deferred.succeed(done, undefined)
          }),
        ),
      )
    })

    const watchIdle = (directory: string, entry: Entry) =>
      InstanceActivity.watchIdle(entry, (revision) =>
        OwnerQuiescence.cleanup(
          Effect.suspend(() => {
            if (entry.activity.revision !== revision || entry.activity.active || entry.activity.pinned)
              return Effect.void
            return Deferred.await(entry.deferred).pipe(
              Effect.flatMap((ctx) => disposeEntry(entry, ctx, revision)),
              Effect.asVoid,
            )
          }).pipe(Effect.uninterruptible),
        ).pipe(Effect.catchCause((cause) => Effect.logWarning("idle instance disposal failed", { directory, cause }))),
      )

    const load = (input: LoadInput, idleTimeout?: number): Effect.Effect<InstanceContext> => {
      const directory = FSUtil.resolve(input.directory)
      return Effect.suspend(() => {
        const existing = cache.get(directory)
        if (existing?.disposing)
          return Deferred.await(existing.disposing).pipe(Effect.andThen(load(input, idleTimeout)))
        if (existing) {
          if (idleTimeout === undefined) {
            existing.activity.pinned = true
            InstanceActivity.notify(existing.activity)
          }
          return Deferred.await(existing.deferred)
        }
        return OwnerQuiescence.activity(
          Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const existing = cache.get(directory)
              if (existing) return yield* restore(load(input, idleTimeout))

              const entry = InstanceActivity.makeEntry(idleTimeout)
              cache.set(directory, entry)
              const loading = InstanceActivity.enter(entry.activity)
              yield* Effect.gen(function* () {
                yield* Effect.logInfo("creating instance", { directory: directory })
                yield* completeLoad(directory, input, entry)
              }).pipe(Effect.ensuring(Effect.sync(() => loading[Symbol.dispose]())), (work) =>
                OwnerQuiescence.fork(work, scope, true),
              )
              if (idleTimeout !== undefined) yield* watchIdle(directory, entry).pipe(Effect.forkIn(scope))
              return yield* restore(Deferred.await(entry.deferred))
            }),
          ),
        )
      }).pipe(Effect.withSpan("InstanceStore.load"))
    }

    const acquire = (input: LoadInput, idleTimeout: number): Effect.Effect<InstanceContext, never, Scope.Scope> =>
      Effect.acquireRelease(
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            while (true) {
              const ctx = yield* restore(load(input, idleTimeout))
              const entry = cache.get(ctx.directory)
              if (!entry || entry.disposing || entry.activity.retired || InstanceActivity.get(ctx) !== entry.activity)
                continue
              return { ctx, lease: InstanceActivity.enter(entry.activity) }
            }
          }),
        ),
        (held) => Effect.sync(() => held.lease[Symbol.dispose]()),
      ).pipe(Effect.map((held) => held.ctx))

    const reload = (input: LoadInput): Effect.Effect<InstanceContext> => {
      const directory = FSUtil.resolve(input.directory)
      return OwnerQuiescence.activity(
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const previous = cache.get(directory)
            if (previous?.disposing) {
              yield* restore(Deferred.await(previous.disposing))
              return yield* reload(input)
            }
            const entry = InstanceActivity.makeEntry(previous?.activity.pinned ? undefined : previous?.idleTimeout)
            cache.set(directory, entry)
            const loading = InstanceActivity.enter(entry.activity)
            yield* Effect.gen(function* () {
              yield* Effect.logInfo("reloading instance", { directory: directory })
              if (previous) {
                yield* Deferred.await(previous.deferred).pipe(Effect.ignore)
                previous.activity.retired = true
                InstanceActivity.notify(previous.activity)
                yield* Effect.promise(() => OwnerQuiescence.cleanupPromise(() => runDisposers(directory, "reload")))
                yield* emitDisposed({ directory, project: input.project?.id })
              }
              yield* completeLoad(directory, input, entry)
            }).pipe(Effect.ensuring(Effect.sync(() => loading[Symbol.dispose]())), (work) =>
              OwnerQuiescence.fork(work, scope, true),
            )
            if (entry.idleTimeout !== undefined) yield* watchIdle(directory, entry).pipe(Effect.forkIn(scope))
            return yield* restore(Deferred.await(entry.deferred))
          }),
        ),
      ).pipe(Effect.withSpan("InstanceStore.reload"))
    }

    const dispose = Effect.fn("InstanceStore.dispose")(function* (ctx: InstanceContext, reason?: DisposeReason) {
      const entry = cache.get(ctx.directory)
      if (!entry) return yield* disposeContext(ctx, reason)

      const exit = yield* Deferred.await(entry.deferred).pipe(Effect.exit)
      if (Exit.isFailure(exit)) return yield* removeEntry(ctx.directory, entry).pipe(Effect.asVoid)
      if (exit.value !== ctx) return
      yield* disposeEntry(entry, ctx, undefined, reason).pipe(Effect.asVoid)
    })

    const disposeDirectory = Effect.fn("InstanceStore.disposeDirectory")(function* (input: string, reason?: DisposeReason) {
      const directory = FSUtil.resolve(input)
      const entry = cache.get(directory)
      if (!entry) return
      const exit = yield* Deferred.await(entry.deferred).pipe(Effect.exit)
      if (Exit.isFailure(exit)) return yield* removeEntry(directory, entry).pipe(Effect.asVoid)
      yield* disposeEntry(entry, exit.value, undefined, reason).pipe(Effect.asVoid)
    })

    const disposalReason = Context.Reference<DisposeReason | undefined>("~opencode/InstanceStore/DisposeReason", {
      defaultValue: () => undefined,
    })
    const disposeAllOnce = Effect.fnUntraced(function* () {
      const reason = yield* disposalReason
      yield* Effect.logInfo("disposing all instances")
      yield* Effect.forEach(
        [...cache.entries()],
        (item) =>
          Effect.gen(function* () {
            const exit = yield* Deferred.await(item[1].deferred).pipe(Effect.exit)
            if (Exit.isFailure(exit)) {
              yield* Effect.logWarning("instance dispose failed", { key: item[0], cause: exit.cause })
              yield* removeEntry(item[0], item[1])
              return
            }
            yield* disposeEntry(item[1], exit.value, undefined, reason)
          }),
        { discard: true },
      )
    })

    const cachedDisposeAll = yield* Effect.cachedWithTTL(disposeAllOnce(), Duration.zero)
    const disposeAll = Effect.fn("InstanceStore.disposeAll")(function* (reason?: DisposeReason) {
      return yield* cachedDisposeAll.pipe(Effect.provideService(disposalReason, reason))
    })

    const provide = <A, E, R>(input: LoadInput, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      load(input).pipe(Effect.flatMap((ctx) => effect.pipe(Effect.provideService(InstanceRef, ctx))))

    yield* Effect.addFinalizer(() => disposeAll().pipe(Effect.ignore))

    return Service.of({
      load: (input) => load(input),
      acquire,
      reload,
      dispose: (ctx, reason) => OwnerQuiescence.cleanup(dispose(ctx, reason).pipe(Effect.uninterruptible)),
      disposeDirectory: (directory, reason) =>
        OwnerQuiescence.cleanup(disposeDirectory(directory, reason).pipe(Effect.uninterruptible)),
      disposeAll: (reason) => OwnerQuiescence.cleanup(disposeAll(reason).pipe(Effect.uninterruptible)),
      provide,
    })
  }),
)

export const bootstrapNode = LayerNode.unbound(InstanceBootstrap.Service, Node.tags.values.global)

export const node = makeGlobalNode({
  service: Service,
  layer: layer,
  deps: [Project.node, bootstrapNode],
})

export * as InstanceStore from "./instance-store"
