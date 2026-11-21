export * as SessionRunCoordinator from "./run-coordinator.js"

import { Deferred, Effect, Exit, Fiber, FiberSet, Scope } from "effect"
import { Event } from "@opencode/schema/event"
import type { EngineStop } from "../engine-stop.js"
import type { Promotable } from "./inbox.js"

/** Serializes execution for each key while allowing different keys to run concurrently. */
export interface Coordinator<Key, E, Reason = never> {
  readonly identity: (key: Key) => Event.ID | null
  readonly compareAndInterrupt: (key: Key, expected: Event.ID, reason?: Reason) => boolean
  /** Snapshots keys with an execution owned by this coordinator. */
  readonly active: Effect.Effect<ReadonlySet<Key>>
  /** Checks ownership for one key, including cleanup and terminal settlement. */
  readonly isActive: (key: Key) => Effect.Effect<boolean>
  /** Starts an execution while idle, or joins the active execution and returns its exit. */
  readonly run: (key: Key) => Effect.Effect<void, E | EngineStop.RefusedError>
  readonly start: (key: Key, retry: string) => Effect.Effect<boolean, EngineStop.RefusedError>
  /** Rings the doorbell: an idle key starts an execution; an active one drains again before settling. */
  readonly wake: (key: Key, scope?: Promotable) => Effect.Effect<void>
  /**
   * Stops the active execution and clears its doorbell. No-op when idle. Resolves once the
   * interruption is accepted, not when cleanup settles: the execution fiber finishes its
   * finalizers and settled hook on its own time. Returns whether an active execution was
   * interrupted.
   */
  readonly interrupt: (key: Key, reason?: Reason) => Effect.Effect<boolean>
  /** Resolves once no execution is active for the key. Returns immediately when already idle and never starts work. */
  readonly awaitIdle: (key: Key) => Effect.Effect<void>
}

/**
 * One execution is a busy period for one key: one fiber that drains from the first wake
 * until the key would stay idle. `pendingWake` is the doorbell: work recorded during the
 * execution rings it with the scope that work needs, and the execution loop drains again
 * instead of ending. The doorbell closes the gap between a drain's last eligibility check
 * and the idle transition, since those cannot be one atomic step. `done` resolves joiners
 * with this execution's exit.
 */
type Execution<E, Reason> = {
  readonly id: Event.ID
  readonly retry?: string
  readonly done: Deferred.Deferred<void, E>
  owner?: Fiber.Fiber<void, unknown>
  scope: Promotable
  pendingWake?: Promotable
  stopping: boolean
  interruptionReason?: Reason
  /** Set once `started` has persisted and the shutdown checkpoint passed; only then may a stop interrupt it. */
  bootstrapped: boolean
}

/**
 * ```text
 *              wake | run
 *      idle ──────────────▶ execution (one fiber)
 *                             drain ⟲ doorbell rung mid-drain
 *                             │ exit (settled hook runs)
 *      doorbell quiet ◀───────┴───────▶ doorbell rung
 *      idle, waiters get exit          successor execution,
 *                                      waiters get this exit
 * ```
 */
export const make = <Key, E, Reason = never>(options: {
  readonly drain: (key: Key, force: boolean, scope: Promotable, owner: Owner) => Effect.Effect<void, E>
  /** Runs once when a process-local busy period begins, before its first drain. */
  readonly started?: (key: Key, id: Event.ID) => Effect.Effect<void>
  /**
   * Runs in the execution fiber for every exit, including interruption, after the final
   * drain and before the execution settles (waiters resolve after it completes).
   */
  readonly settled?: (key: Key, exit: Exit.Exit<void, E>, reason?: Reason) => Effect.Effect<void>
  /**
   * Engine admission claims. Each execution holds one from before it is registered until it settles; a successor
   * started at settlement inherits it, so the gate never sees a gap between them. A stop request interrupts a
   * bootstrapped execution with `shutdownReason`, and the checkpoint after `started` stops one that was asked to
   * shut down before it could be interrupted, so it never reaches `drain`.
   */
  readonly claims?: EngineStop.Interface
  readonly shutdownReason?: Reason
}): Effect.Effect<Coordinator<Key, E, Reason>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const executions = new Map<Key, Execution<E, Reason>>()
    const fork = yield* FiberSet.makeRuntime<never, void, never>()
    const forkScope = yield* Effect.scope
    const claims = options.claims

    const loop = (key: Key, execution: Execution<E, Reason>, force: boolean): Effect.Effect<void, E> =>
      Effect.suspend(() =>
        options.drain(key, force, execution.scope, {
          id: execution.id,
          retry: execution.retry,
          current: () => executions.get(key) === execution && !execution.stopping && execution.owner !== undefined,
        }),
      ).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            if (execution.stopping || execution.pendingWake === undefined) return Effect.void
            execution.scope = execution.pendingWake
            execution.pendingWake = undefined
            // Trampoline so drains that complete synchronously cannot grow the stack.
            return Effect.yieldNow.pipe(Effect.andThen(loop(key, execution, false)))
          }),
        ),
      )

    const checkpoint = (key: Key, execution: Execution<E, Reason>) =>
      claims
        ? claims.shutdownRequested.pipe(
            Effect.orDie,
            Effect.flatMap((requested) => {
              if (!requested) return Effect.sync(() => (execution.bootstrapped = true))
              execution.stopping = true
              execution.pendingWake = undefined
              execution.interruptionReason = options.shutdownReason
              return Effect.interrupt
            }),
          )
        : Effect.sync(() => (execution.bootstrapped = true))

    // Starts an execution unless one exists for the key, which `existing` then handles. The claim is taken before
    // registration, and the map is checked again after it because taking it is effectful.
    const start = <A>(
      key: Key,
      force: boolean,
      scope: Promotable,
      existing: (execution: Execution<E, Reason>) => A,
      created: (execution: Execution<E, Reason>) => A,
      retry?: string,
    ): Effect.Effect<A, EngineStop.RefusedError> =>
      Effect.scoped(
        Effect.gen(function* () {
          // Retaining never needs a current owner, so it cannot fail with an ownership error.
          const reservation = claims
            ? yield* claims.retain().pipe(Effect.catchTag("EngineStop.OwnershipError", Effect.die))
            : undefined
          const current = executions.get(key)
          if (current !== undefined) return existing(current)
          const execution: Execution<E, Reason> = {
            id: Event.ID.create(),
            retry,
            done: Deferred.makeUnsafe<void, E>(),
            scope,
            stopping: false,
            bootstrapped: false,
          }
          executions.set(key, execution)
          // The leading yield lets `owner` be assigned before the drain can settle, and keeps
          // failing self-waking executions from growing the stack across successor starts.
          // Drains start one tick after wake; callers observe progress through events or run.
          const body = Effect.yieldNow.pipe(
            Effect.andThen(Effect.uninterruptible(options.started?.(key, execution.id) ?? Effect.void)),
            Effect.andThen(checkpoint(key, execution)),
            Effect.andThen(loop(key, execution, force)),
            Effect.onExit((exit) =>
              Effect.sync(() => {
                execution.owner = undefined
              }).pipe(Effect.andThen(options.settled?.(key, exit, execution.interruptionReason) ?? Effect.void)),
            ),
            Effect.onExit((exit) => settle(key, execution, exit)),
            Effect.exit,
            Effect.asVoid,
          )
          execution.owner = reservation
            ? yield* reservation
                .fork(
                  body,
                  forkScope,
                  // Fire and forget: awaiting settlement here would wait on this execution's own fiber.
                  Effect.sync(() => {
                    if (execution.bootstrapped) stop(key, execution, options.shutdownReason)
                  }),
                )
                .pipe(Effect.orDie)
            : fork(body)
          return created(execution)
        }),
      )

    // A doorbell that survives the execution loop (rung after the loop decided to end, or
    // during failure or interruption cleanup) starts a fresh execution for the remaining work.
    // It runs in the settling execution's fiber, so the successor inherits that execution's claim.
    // The settling claim ends after any successor holds its own and before `done` resolves: waiters
    // resume synchronously on `done`, and an idle Session must never still count as active work.
    const settle = (key: Key, execution: Execution<E, Reason>, exit: Exit.Exit<void, E>) =>
      Effect.suspend(() => {
        if (executions.get(key) === execution) executions.delete(key)
        const next = execution.pendingWake
        if (next === undefined) return Effect.void
        return start(
          key,
          false,
          next,
          (current) => ring(current, next),
          () => undefined,
        ).pipe(Effect.catchTag("EngineStop.RefusedError", () => Effect.void))
      }).pipe(
        Effect.ensuring(
          Effect.andThen(
            claims?.releaseCurrent ?? Effect.void,
            Effect.sync(() => Deferred.doneUnsafe(execution.done, exit)),
          ),
        ),
      )

    const isActive = (key: Key) => Effect.sync(() => executions.has(key))

    const join = (key: Key, execution: Execution<E, Reason>): Effect.Effect<void, E | EngineStop.RefusedError> =>
      // A stopping execution refuses joiners: wait out its cleanup, then run fresh.
      execution.stopping
        ? Deferred.await(execution.done).pipe(Effect.ignoreCause, Effect.andThen(run(key)))
        : Deferred.await(execution.done)

    const run = (key: Key): Effect.Effect<void, E | EngineStop.RefusedError> =>
      Effect.suspend(() => {
        const execution = executions.get(key)
        if (execution !== undefined) return join(key, execution)
        return start(
          key,
          true,
          "input",
          (current) => join(key, current),
          (created) => Deferred.await(created.done),
        ).pipe(Effect.flatten)
      })

    const startDetached = (key: Key, retry: string) =>
      start(
        key,
        true,
        "input",
        () => false,
        () => true,
        retry,
      )

    const ring = (execution: Execution<E, Reason>, scope: Promotable) => {
      // Coalesced wakes keep the widest scope: "input" subsumes "steer".
      execution.pendingWake = execution.pendingWake === "input" ? "input" : scope
    }

    // A wake refused by a closed engine leaves its durable input owed for the next engine.
    const wake = (key: Key, scope: Promotable = "input") =>
      Effect.suspend(() => {
        const execution = executions.get(key)
        if (execution !== undefined) return Effect.sync(() => ring(execution, scope))
        return start(
          key,
          false,
          scope,
          (current) => ring(current, scope),
          () => undefined,
        ).pipe(Effect.catchTag("EngineStop.RefusedError", () => Effect.void))
      })

    const stop = (key: Key, execution: Execution<E, Reason> | undefined, reason?: Reason) => {
      if (execution === undefined || execution.stopping || executions.get(key) !== execution) return false
      if (execution.owner === undefined) {
        // Settlement window: the owner exited but the settled hook has not finished. The
        // terminal outcome is already decided, so no reason attaches — but the interrupt
        // still claims the recorded wakes so settle does not start a dead-intent successor.
        execution.pendingWake = undefined
        return false
      }
      execution.stopping = true
      // Wakes recorded so far belong to the interrupted intent; the interrupt claims them.
      // Wakes arriving during cleanup are new admissions and restart normally at settle.
      execution.pendingWake = undefined
      execution.interruptionReason = reason
      // Fire and forget: nobody benefits from waiting out cleanup here, and callers like
      // the interrupt endpoint must acknowledge immediately even when finalizers are slow.
      fork(Fiber.interrupt(execution.owner))
      return true
    }
    const interrupt = (key: Key, reason?: Reason): Effect.Effect<boolean> =>
      Effect.sync(() => stop(key, executions.get(key), reason))
    const identity = (key: Key) => executions.get(key)?.id ?? null
    const compareAndInterrupt = (key: Key, expected: Event.ID, reason?: Reason) => {
      const execution = executions.get(key)
      if (execution?.id !== expected || execution.stopping || execution.owner === undefined) return false
      return stop(key, execution, reason)
    }

    // One execution's `done` already spans coalesced continuations; re-check after it
    // settles to cover a successor execution started by a late doorbell.
    const awaitIdle = (key: Key): Effect.Effect<void> =>
      Effect.suspend(() => {
        const execution = executions.get(key)
        if (execution === undefined) return Effect.void
        return Deferred.await(execution.done).pipe(Effect.ignoreCause, Effect.andThen(awaitIdle(key)))
      })

    return {
      active: Effect.sync(() => new Set(executions.keys())),
      identity,
      compareAndInterrupt,
      isActive,
      run,
      start: startDetached,
      wake,
      interrupt,
      awaitIdle,
    }
  })

/** Permission to dispatch exists only while this process-local execution may still run. */
export interface Owner {
  readonly id: Event.ID
  readonly retry?: string
  readonly current: () => boolean
}
