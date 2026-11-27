# Keep snapshot contention from holding tool dispatch indefinitely

## Identity

- Workday: 2026-11-27
- Session: [`ses_de3bc20f4ffef42eT1d1dK6NI0`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_de3bc20f4ffef42eT1d1dK6NI0) (desktop)
- Reviewer and deploy owner: [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv)
- Branches: `fix/snapshot-stdout-drain`, `snapshot-track-cohorts`, `dev-nowaker`; upstream deadline candidate `snapshot-diff-deadline` from `c618499abc` (`v1.19.6`).

## Request and result

> Check https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_df3e67aa9ffeRjlBdScs82cl77 how that session got stuck. Portal was showing me that tool as still running but I doubt it was the case, stuck detector showed bash tool as dead.

The coordinator's final policy was to dispatch a streamed tool after 120 seconds of snapshot contention, record the skipped undo capture, and have file revert report that no snapshot exists. Abort, a genuine capture error, and a deferred replay with no active capture fence still do not dispatch on a failed preflight. The coordinator kept land gated on a compiled Linux reproduction and retained install/restart ownership.

- The three original calls had been recorded as running before dispatch. Their first snapshot was held in a same-store semaphore queue; the initial Bash had no shell metadata or launch record. The 07:47 UTC group completed at 09:48-09:49; the next group queued again at 09:56. The DB stuck detector used the tool row's apparent start, not shell process evidence.
- Snapshot `cat-file --batch` was observed with a full stdout socket while holding the gitdir semaphore. The natural pipe and compiled large-blob controls did not reproduce the stream fault. No spawner changes were made.
- [`ee5d3e7f44`](https://gitlab.com/vibeterm/opencode/-/commit/ee5d3e7f44) caps the locked diff body at 30 seconds, including fallback. It reaps the child before releasing the lock and does not use a stale hash after failed staging.
- [`0518402385`](https://gitlab.com/vibeterm/opencode/-/commit/0518402385) records the wait and execution phase, revokes unfinished publication for that session when the wait expires, and only then dispatches with `snapshot: "skipped"`. File revert crossing that gap refuses before changing files or a pending revert; messages-only revert remains available.
- [`fa76609068`](https://gitlab.com/vibeterm/opencode/-/commit/fa76609068) adds `queue_wait_ms` and `lock_hold_ms` to the existing snapshot operation receipt, keeping `duration_ms` as their total. It carries the review trailer without changing the verified tree.

## Landing and verification

- `dev-nowaker`: retained the intervening MCP source tip `93993bfd5d` and its forklog `ce4561fff8` through merge commits, no rebase. Both mirrors and desktop fast-forwarded to [`fb97c606d4`](https://gitlab.com/vibeterm/opencode/-/commit/fb97c606d4). The final MCP forklog merge changed only `.vibeterm/forklog` relative to the tested `89404116ce`. The dirty retry patch's diff hash matched before and after fast-forward.
- Gated m2pro focused suite on the merged source: 203 passed, 1 skipped, 0 failed. Package typecheck final line `$ tsgo --noEmit`, exit 0. Pre-push typechecks on GitLab and GitHub each passed 30/30 tasks.
- Gated compiled Linux build: `bun ./script/build.ts --single --skip-install --skip-embed-web-ui`, exit 0. The intentionally held 120-second baseline allowed Bash to write, made file revert return HTTP 400 without changing the file, and attached no snapshot/patch after release. The locked diff control reaped its child and released queued Bash after 29,928 ms. A natural 524,288-byte-per-blob control persisted the exact 1,048,870-byte patch and completed the next Bash. All three scenarios exited 0.
- Red controls: a compiled baseline left Bash queued behind the blocked batch at 45 seconds; targeted tests reproduced stalled batch and fallback, stale track hash, rejected tools under the prior timeout policy, unsafe revert across a gap, and missing split timing fields.
- The upstream v1 deadline port [`7b6c5da05f`](https://github.com/Nowaker/opencode/commit/7b6c5da05f) had 3 targeted failures on its unmodified base and then passed 66 tests with 1 skip and 0 failures; `tsgo --noEmit` exited 0. It occupies [queue entry 17](../pr-queue/17-snapshot-diff-deadline.md); no PR was opened.

## Follow-up: share adjacent queued track captures

- Reviewed source `5bb04a7ecf` shares one Git capture for adjacent requests still waiting for the same store, scan directory and clean process-local writer generation. It seals the cohort before reading the working tree, preserves restore order, and leaves sibling waits intact when the first caller cancels. An invalidated cohort retries the individual captures before any later restore. No completed tree is cached.
- Registered local Git, file tool, shell and plugin lifetimes inform eligibility. A native write interrupted before its callback can be confirmed disables sharing for that worktree in that process. External editors, other processes, remote RPCs and escaped child processes are not covered.
- The original fixtures measured three captures instead of one for adjacent callers and four instead of two across a restore. The five focused tests then passed: they count real `git write-tree` executions and check tree bytes, including a late request and a write invalidating an in-flight capture. The real Bash handoff test proves the writer stays registered beyond the foreground tool result.
- Merge `fc3e285f4` retains `dev-nowaker` at `5531fa1869` as a parent and carries the coordinator review trailer. The merged snapshot, tool, and session suites on m2pro passed 281 tests with 1 skip and 0 failures across 14 files. The package typecheck exited 0 (`$ tsgo --noEmit`).
- This is not a standalone port to `github/v1`: that base has synchronous session snapshots and lacks the fork's concurrent preflight paths, writer coverage, and timing receipt. An upstream version would need separate integration and verification; no queue entry was created.

## Features and boundaries

- [Async snapshots](../features/2026-11-01-async-snapshots.md): separate dispatch budget and explicit file undo gap.
- [Snapshot operation timing](../features/2026-10-27-snapshot-housekeeping.md): legacy total plus queue and lock-hold durations.
- The skip fence is per session, not a filesystem write fence across other sessions. Coalescing is a separate reviewed source change and does not establish quiescence for writers outside the current process.
- No install or restart by this session. This record's introducing commit is the forklog commit.
