# Reopen opencode.log after an external rotation

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `log-reopen` (off upstream `dev` `907b3bc518`; also the upstream PR head)
- First local commit: `d1442208f5`
- Current local commit(s): `d1442208f5`
- Upstream base when introduced: `2fa3363c92` (upstream `dev`, contains `v1.18.33`)
- Last checked against upstream: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Upstream: issue [#53089](https://github.com/anomalyco/opencode/issues/53089), PR [#53090](https://github.com/anomalyco/opencode/pull/53090)

## Original request

Relayed by opencode-tools coordinator `ses_efbf81be2ffeOUhnv0uLJM0Jog`, condensed:

> make opencode reopen its log file when an external rotator renames it [...]
> Before each batch write, compare stat(path) ino/dev with fstat(fd); ENOENT
> counts as renamed. If they differ, close and reopen the path with
> O_APPEND|O_CREAT [...] Do not change log format, location or level handling.

## Goals

- A rename-based rotator (opencode-tools retention-clean renames
  `opencode.log` to `opencode.log.draining`) loses nothing: the next batch
  after the rename lands in a fresh `opencode.log`.
- A deleted `opencode.log` is recreated on the next batch.

## Non-goals

- No built-in rotation or trimming; rotation stays external.
- No change to format, path, level handling or the 1 s batch window.

## Rationale and constraints

- Every process appends to one `opencode.log`, and Effect's `Logger.toFile`
  holds one descriptor for the process lifetime, so after a rename every
  running process kept writing into the renamed file until restart.
  `copytruncate` can drop the lines written between copy and truncate.
- The check is one `stat` + `fstat` per flush (at most 1/s), nothing per line,
  and needs no signal to the writer.
- The new file is opened before the old is closed: a failed reopen still
  writes the batch to the old file. The descriptor closes after the batcher's
  final flush (finalizers run in reverse).
- Each runtime that provides `Observability.layer` builds its own file logger
  (a serve process holds 2 descriptors at startup). An instance that never
  flushes again never re-checks, so it keeps the renamed inode open without
  writing to it until the process exits. retention-clean drains by mtime
  quiet, not by open descriptors, so draining is unaffected; the unlinked
  inode's space is freed at that instance's next flush or process exit.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `d1442208f5` | 2026-10-03 | `fileLogger` builds `Logger.batched` with a dev/ino check and reopen before each write | `fileLogger` and `sameFile` in `packages/core/src/observability/logging.ts`; describe "file logger after the log file is moved" in `packages/core/test/effect/observability.test.ts` |

## Verification

- `bun test test/effect/observability.test.ts` in `packages/core` - 8 pass;
  the rename and delete tests fail without the change.
- `bun typecheck` in `packages/core` - exit 0; pre-push full typecheck of
  the upstream branch - 30/30 tasks.
- Installed `1.18.33-vt-59-2fa3363c92`, isolated `opencode serve` on
  127.0.0.1: after `mv opencode.log opencode.log.old` and requests, `.old`
  stayed at 3 lines and the new `opencode.log` got 31; after `rm` the file
  was recreated (10 lines) and `.old` unchanged.

## Timeline

- 2026-10-03
  [`ses_efb698c02ffefXlxsxKlISKpRH`](../sessions/2026-10-03-log-reopen.md)
  - `d1442208f5`: introduce; build and install on desktop and m4max
    (`vt-60`); open upstream issue #53089 and PR #53090.
- 2026-10-04 [`ses_ef81db9cdffe5vRz7Y2HqCmvNs`](../sessions/2026-10-04-upstream-1.18.34.md) -
  rebased unchanged onto upstream `dev`
  `907b3bc518` (contains `v1.18.34`). Evidence: that session's gates.

## Current maintenance notes

- Drop the fork commit once PR #53090 (or an equivalent) is in upstream `dev`.
- If upstream ports #47676's in-place trimming from `v2` into `dev`, both
  coexist: trimming rewrites the same inode, so no reopen is triggered.

### Upstream integration checklist

- Locate `fileLogger` in the new upstream tree; check it still builds the
  batched logger rather than `Logger.toFile`.
- Run `test/effect/observability.test.ts` and `bun typecheck` in
  `packages/core`.
- Build through `.vibeterm/build.sh`; repeat the isolated `mv` check.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
