import { Effect, Exit } from "effect"
import type { InstanceContext } from "@/project/instance-context"

type WriterState = { generation: number; active: number; unsafe?: true }

// Keep the last generation even after the last writer exits: a capture that
// overlapped a complete write must still see a different generation.
const states = new Map<string, WriterState>()

export function snapshotWorktree(instance: InstanceContext | undefined) {
  return instance?.project.vcs === "git" ? instance.worktree : undefined
}

function enter(worktree: string) {
  const state: WriterState = states.get(worktree) ?? { generation: 0, active: 0 }
  states.set(worktree, state)
  state.generation++
  state.active++
  return state
}

export const snapshotWriters = {
  current(worktree: string): Readonly<WriterState> {
    const state = states.get(worktree)
    return state ? { ...state } : { generation: 0, active: 0 }
  },

  hold<A, E, R>(
    worktree: string | undefined,
    work: Effect.Effect<A, E, R>,
    options?: { readonly unsafeOnInterrupt: boolean },
  ) {
    if (worktree === undefined) return work
    return Effect.acquireUseRelease(
      Effect.sync(() => enter(worktree)),
      () => work,
      (state, exit) =>
        Effect.sync(() => {
          // Interrupted native file calls can still be settling. Do not treat
          // the now-idle count as evidence that captures may be shared again.
          if (options?.unsafeOnInterrupt && Exit.hasInterrupts(exit)) state.unsafe = true
          state.active--
        }),
    )
  },

  // An interrupted Effect waiter does not cancel an arbitrary JS callback.
  // Release on settlement of the actual Promise, not on exit of that waiter.
  async runPromise<A>(worktree: string, work: () => PromiseLike<A>) {
    const state = enter(worktree)
    try {
      return await work()
    } finally {
      state.active--
    }
  },
}
