# Stop the file logger waking every second while idle

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `lazy-log-flush` (off upstream `dev` `ecc4916b5a`; also the upstream PR head), landed through `idle-perf-land`
- First local commit: `bb01eb1db2`
- Current local commit(s): `bb01eb1db2`
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `ecc4916b5a` (upstream `dev`)
- Upstream: issue [#53673](https://github.com/anomalyco/opencode/issues/53673), PR [#53674](https://github.com/anomalyco/opencode/pull/53674)

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 13), the user's words:

> cpu usage when idle - opencode doing nothing should not waste cpu. it should
> be invisible. profile deeply. profile diligently. figure out what it's
> wasting unneeded cpu cycles on, and improve.

## Goals

- An idle opencode has no repeating timer from the file logger on either the
  TUI thread or the server worker.
- Logged lines still reach disk within one 1 s batch window, batched, and the
  scope finalizer still flushes on shutdown.

## Non-goals

- No change to log format, path, level handling or the batch window.

## Rationale and constraints

- `Logger.batched` (and so `Logger.toFile`) forks a fiber that runs
  `sleep(window) -> flush` forever. A JSC sampler + timer census of an idle
  vanilla 1.18.34 home screen showed exactly one `setTimeout(1000)` plus the
  scheduler's `setImmediate` per second on each thread and nothing else
  repeating; the fiber had no span or stack-frame annotation.
- The replacement waits on a `Latch` that the logger opens when a line
  arrives, then sleeps one window, closes the latch and flushes.
- On `dev-nowaker` this composes with [log reopen](./2026-10-03-log-reopen.md):
  the dev/ino check and reopen run inside the new flush. The upstream PR is
  against plain `Logger.toFile`; whichever of #53090 / #53674 merges second
  upstream needs the same composition.
- Rejected: `MIMALLOC_PURGE_DELAY=1000` for the scavenger wakeups this also
  reduces - measured no gain (fork 1.88 / 1.81% vs 2.09 / 1.97%).

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `bb01eb1db2` | 2026-10-06 | `fileLogger` batches through a latch-armed flush loop instead of `Logger.batched` | `fileLogger` in `packages/core/src/observability/logging.ts`; test "file logger writes lines within the batch window while the scope stays open" in `packages/core/test/effect/observability.test.ts` |

## Verification

- `bun test test/effect/observability.test.ts` in `packages/core` on
  `idle-perf-land` - 9 pass (includes log-reopen's rename and delete tests).
- `bun typecheck` in `packages/core` - exit 0.
- Idle CPU, compiled binary, `--pure`, home screen, ABBA, 240 s windows after
  90 s warmup (`opencode-idle-bench abba`), % of one core: desktop vanilla
  1.98 / 1.72 vs lazylog 1.60 / 1.55; m2pro vanilla 2.05 vs 1.73 / 1.76.
  About -15%, with fewer main, Worker and mi-scavenger wakeups.

## Timeline

- 2026-10-06
  [`ses_eec5b2a34ffe9sjf6Wf21vNSMg`](../sessions/2026-10-06-idle-cpu-startup.md)
  - `bb01eb1db2`: introduce, measured on desktop and m2pro; upstream issue
    #53673 and PR #53674; build and install on desktop and m4max.

## Current maintenance notes

- Drop the fork commit once PR #53674 (or an equivalent) is in upstream `dev`,
  keeping the reopen composition if #53090 is still fork-only.

### Upstream integration checklist

- Locate `fileLogger`; check it still owns its flush loop and that no
  `Logger.batched` / `Logger.toFile` timer came back.
- Run `test/effect/observability.test.ts` and `bun typecheck` in
  `packages/core`.
- Optional: `opencode-idle-bench abba` against the previous build.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
