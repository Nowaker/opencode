import { Deferred, Effect, Exit, Fiber, type Scope } from "effect"
import { snapshotWriters } from "./writers"

export type CohortStats = {
  readonly cohort_size: number
  readonly join_count: number
}

type WriterState = ReturnType<typeof snapshotWriters.current>
const clean = (state: WriterState) => state.active === 0 && !state.unsafe
const single: CohortStats = { cohort_size: 1, join_count: 0 }

type Ticket = {
  readonly grant: () => void
}

type Permit = Ticket & {
  readonly ready: Deferred.Deferred<void>
}

const permit = (): Permit => {
  const ready = Deferred.makeUnsafe<void>()
  return {
    ready,
    grant() {
      Deferred.doneUnsafe(ready, Effect.void)
    },
  }
}

type Track = {
  readonly scope: Scope.Scope
  readonly directory: string
  readonly worktree: string
  readonly capture: (stats: CohortStats) => Effect.Effect<string>
}

type Cohort = {
  readonly directory: string
  readonly worktree: string
  readonly generation: number
  readonly waiters: Set<Ticket>
  readonly done: Deferred.Deferred<Exit.Exit<string | undefined>>
  joinCount: number
  settled: boolean
  owner?: Fiber.Fiber<void>
}

export function makeSnapshotStore() {
  const queue: Ticket[] = []
  let pending: Cohort | undefined

  const enqueue = <T extends Ticket>(ticket: T) => {
    queue.push(ticket)
    if (queue.length === 1) ticket.grant()
    return ticket
  }

  const release = (ticket: Ticket) => {
    const index = queue.indexOf(ticket)
    if (index < 0) return
    queue.splice(index, 1)
    const head = queue[0]
    if (index === 0 && head) head.grant()
  }

  const within = <A, E, R>(ticket: Permit, work: Effect.Effect<A, E, R>) =>
    Effect.andThen(Deferred.await(ticket.ready), work)

  const barrier = () => {
    pending = undefined
    return enqueue(permit())
  }

  const locked = <A, E, R>(work: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      Effect.sync(barrier),
      (ticket) => within(ticket, work),
      (ticket) => Effect.sync(() => release(ticket)),
    )

  const close = (cohort: Cohort) => {
    if (pending === cohort) pending = undefined
  }

  const start = (input: Track, cohort: Cohort) => {
    const admitted = Deferred.makeUnsafe<{ readonly size: number; readonly before: WriterState }>()
    const ticket = enqueue({
      grant() {
        close(cohort)
        // A writer that finished while this slot was queued is part of the baseline.
        Deferred.doneUnsafe(
          admitted,
          Effect.succeed({ size: cohort.waiters.size, before: snapshotWriters.current(input.worktree) }),
        )
      },
    })
    return Effect.gen(function* () {
      const { size, before } = yield* Deferred.await(admitted)
      if (cohort.waiters.size === 0) return yield* Effect.interrupt
      if (size > 1 && !clean(before)) return
      const value = yield* input.capture({ cohort_size: size, join_count: cohort.joinCount })
      return { value, before, size }
    }).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          close(cohort)
          cohort.settled = true
          if (Exit.isFailure(exit)) {
            Deferred.doneUnsafe(cohort.done, Effect.succeed(Exit.failCause(exit.cause)))
          } else {
            const result = exit.value
            const now = snapshotWriters.current(input.worktree)
            const value =
              result && (result.size === 1 || (clean(now) && now.generation === result.before.generation))
                ? result.value
                : undefined
            // Expand the current slot, not the tail: a later restore must
            // still run after every member that was ordered before it.
            if (value === undefined) queue.splice(1, 0, ...cohort.waiters)
            Deferred.doneUnsafe(cohort.done, Effect.succeed(Exit.succeed(value)))
          }
          release(ticket)
        }),
      ),
      Effect.asVoid,
      Effect.forkIn(input.scope, { startImmediately: true, uninterruptible: false }),
    )
  }

  const track = (input: Track) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const writer = snapshotWriters.current(input.worktree)
        if (!clean(writer)) {
          const ticket = barrier()
          return yield* restore(within(ticket, input.capture(single))).pipe(
            Effect.ensuring(Effect.sync(() => release(ticket))),
          )
        }

        const member = permit()
        const tail = pending
        const joined =
          tail?.directory === input.directory && tail.worktree === input.worktree && tail.generation === writer.generation
        const cohort: Cohort = joined
          ? tail
          : {
              directory: input.directory,
              worktree: input.worktree,
              generation: writer.generation,
              waiters: new Set(),
              done: Deferred.makeUnsafe(),
              joinCount: 0,
              settled: false,
            }
        cohort.waiters.add(member)
        if (joined) cohort.joinCount++
        else {
          pending = cohort
          cohort.owner = yield* start(input, cohort)
        }

        return yield* restore(
          Effect.gen(function* () {
            // Carry Exit as data so even an interrupted owner wakes every waiter.
            const exit = yield* Deferred.await(cohort.done)
            const value = yield* exit
            if (value !== undefined) return value
            return yield* within(member, input.capture(single))
          }),
        ).pipe(
          Effect.ensuring(
            Effect.suspend(() => {
              cohort.waiters.delete(member)
              if (cohort.settled) return Effect.sync(() => release(member))
              if (cohort.waiters.size !== 0) return Effect.void
              close(cohort)
              return cohort.owner ? Fiber.interrupt(cohort.owner) : Effect.void
            }),
          ),
        )
      }),
    )

  return { locked, track }
}
