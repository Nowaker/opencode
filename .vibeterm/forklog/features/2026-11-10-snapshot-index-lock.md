# Wait for an index.lock another process holds in the snapshot store

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `snapshot-index-lock` (cut from `dev-nowaker` `770f0e7efd`); upstreamable twin `snapshot-lock-upstream` on `github/v1` (`ec838f8fcf`, `10c014b816`, pushed to `nowaker-github`, PR not opened)
- First local commit: `aeaa71c967`
- Current local commit(s): `aeaa71c967`, `29e7545775`, merge `3b0f177f0b`
- Upstream base when introduced: `006d837c50` (`v1.19.5`, `github/v1`)
- Last checked against upstream: `006d837c50`

## Original request

Coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv), user approval [`qst_1aaf2cbbd001dAKyiwxju7twtX`](https://portal.vibeterm.desktop.ts.nowaker.net/question/qst_1aaf2cbbd001dAKyiwxju7twtX) "Fix the index.lock race":

> in the snapshot code (packages/opencode/src/snapshot/), retry `git add` / `write-tree` (and any other index-writing step) with a short, bounded backoff with jitter when the failure is a held index.lock owned by another process. Never delete a lock. Log the retries, and give up with today's behaviour once the budget is spent. Add a test that fails on the old code: two concurrent snapshot writers on the same store both produce a snapshot.

## Goals

- Two opencode processes on the same worktree both get a snapshot when they stage at the same moment.
- A held `index.lock` is waited for, never removed.
- `git add --pathspec-from-file=-` exiting on a held lock without reading its stdin no longer throws an uncaught `EPIPE`.

## Non-goals

- No cross-process store lock; the in-process semaphore stays as it is.

## Rationale and constraints

- [Reliability check 2026-11-05](./2026-11-01-async-snapshots.md#reliability-check-2026-11-05): 179 of 56,832 finished turns had a step without a snapshot after a cross-process `index.lock` collision in `git add` or `write-tree`. The store lock (`Semaphore` keyed by gitdir) is process-local, and upstream has the same race.
- Every snapshot git call goes through the retrying wrapper, not only `add` and `write-tree`: `rm --cached`, `read-tree` and `checkout-index` take the same lock, and a call that cannot hit it pays nothing.
- Budget: 8 retries, 25 ms doubling to at most 800 ms, each multiplied by a random factor in [0.5, 1), about 1.6-3.2 s in total; the caller's step already waits for the store lock, so a short bound keeps that wait small.
- The first version of the retry test crashed the test runner with `EPIPE: broken pipe, write`: `NodeSink.fromWritable` removes its error listener once a write returns, so the EPIPE from a child that already closed stdin arrives with no listener. The TUI worker swallows uncaught exceptions, `serve` and `run` do not.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `aeaa71c967` | 2026-11-10 | A persistent error listener on a spawned child's stdin drops `EPIPE` and rethrows any other error | `setupStdin` in `packages/core/src/cross-spawn-spawner.ts`; test "input the command closed its stdin against is not an uncaught error" |
| `29e7545775` | 2026-11-10 | `git` in the snapshot state retries a result whose stderr shows `index.lock': File exists`, logging `snapshot index.lock held by another process, retrying` per retry and `snapshot index.lock still held, giving up` at the end; the raw spawn is `spawn` | `heldIndexLock`, `lockRetries`/`lockDelay`/`lockDelayCap`, `git` and `spawn` in `packages/opencode/src/snapshot/index.ts` |
| `29e7545775` | 2026-11-10 | Tests | `snapshot.test.ts`: "track waits for an index.lock another process holds, and leaves that lock alone", "two processes snapshotting the same worktree at once both get a snapshot" |
| `3b0f177f0b` | 2026-11-10 | Fork merge, no conflicts | - |

## Verification

- `bun run test test/snapshot/snapshot.test.ts` in the worktree and on merged `dev-nowaker`: 69 pass, 1 skip, 0 fail. The two new tests pass 6 of 6 repeated runs; with `index.ts` restored to `dev-nowaker` `770f0e7efd` both fail (5 of 5 runs).
- `bun run test test/effect/cross-spawn-spawner.test.ts` in `packages/core`: 25 pass; with `cross-spawn-spawner.ts` restored to the parent, the new test fails with `EPIPE: broken pipe, write` (3 of 3 runs).
- `bun typecheck` clean in `packages/opencode` and `packages/core`.
- Upstream twin on `github/v1`: snapshot suite 57 pass, 1 skip; the two new tests fail on `github/v1`'s `index.ts` and pass with the change; spawner suite 25 pass; typechecks clean.
- Installed `1.19.5-vt-419-006d837c50` on desktop and m4max: v2 guard gate passed, both log strings and the retry-header marker in the binary, `.vibeterm/smoke.sh` SMOKE OK.

## Timeline

- 2026-11-10 [`ses_e3b674d77ffe6z70yBg7vCW6nj`](../sessions/2026-11-10-snapshot-index-lock.md) - initial build. Evidence: `aeaa71c967`, `29e7545775`, merge `3b0f177f0b`, vt-419 on both hosts.

## Current maintenance notes

- Upstream PR body draft: `.vibeterm/tmp/opencode/snapshot-lock-upstream-pr.md` (untracked); branch `snapshot-lock-upstream` on `nowaker-github`. Once the upstream fix lands, drop this customization in the next bump.
- `heldIndexLock` matches git's English message `index.lock': File exists`; a git run under another locale would not retry. The snapshot git calls inherit the user's environment.
