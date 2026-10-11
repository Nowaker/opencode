# Log which process holds the SQLite write lock too long

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `sqlite-hold-log` (upstream PR, cut from `github/v1`),
  `sqlite-hold-fork` (fork integration)
- First local commit: `e84637783a`
- Current local commit(s): `e84637783a`
- Upstream base when introduced: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Last checked against upstream: `dfb56f76c7`
- Upstream PR: [anomalyco/opencode#54580](https://github.com/anomalyco/opencode/pull/54580)
  (base `v1`, head `Nowaker:sqlite-hold-log` = `4dda0c44e3`)

## Original request

Spawned by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 31, the user
approved "Add holder logging"):

> **Goal.** Every writer we control logs a warning when it holds a write
> transaction (or the write lock outside an explicit transaction, e.g. a long
> autocommit statement, checkpoint, vacuum, migration) longer than a threshold
> (~5 s; configurable via env), with: pid, process name/argv0 (opencode
> TUI/serve, which Vibeterm daemon), session id where known, phase/operation
> name, hold duration, and statement kind (no SQL params, no paths beyond what
> existing logs show). Log once when the threshold is crossed (so a hold that
> never ends is still caught) and once at release with the total.

## Goals

- A hold of the write lock past `OPENCODE_SQLITE_WRITE_HOLD_WARN_MS` (default
  5000, `0` disables) logs `sqlite write lock held` with `event=crossed` while
  still held and `event=released` with the total.
- A long autocommit write logs `event=statement` after it returns.
- Fields: pid, executable, known CLI subcommand, up to three non-SQL span
  names, the `session.id` span attribute, statement kind and table.

## Non-goals

- Identifying writers outside opencode's own connection; opencode-tools
  writers log through `_lib/sqlite-write-hold` (same line format).
- Changing acquisition retry or `busy_timeout` (see
  [SQLite admission](./sqlite-admission.md)).

## Rationale and constraints

- `SQLITE_BUSY` killed 38 turns in 14 days on desktop. The waiter diagnostics
  (`sqlite.phase=acquire sqlite.elapsedMs=60154`) showed a one-minute hold on
  2026-10-10T03:47Z but nothing named the holder.
- Tracking sits in the SQLite connection layer (`sqlite.bun.ts`,
  `sqlite.node.ts`), so every statement path is covered: transactions,
  migrations, checkpoints, project copy refresh, snapshot and event writes.
- The crossing warning fires from a timer; opencode's transactions yield
  between statements, so it fires while the lock is still held. A single
  synchronous statement can only be reported after it returns.
- A statement that failed (a `BEGIN` that timed out on `busy_timeout`) waited
  and never held the lock, so it is not logged.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `e84637783a` | 2026-10-11 | Hold tracker, statement classifier, warning line | `packages/core/src/database/write-hold.ts` (`WriteHold.make`, `classify`, `threshold`) |
| `e84637783a` | 2026-10-11 | Every statement through the tracker, around the fork's retired-session write retry | `run`/`runValues` in `packages/core/src/database/sqlite.bun.ts` and `sqlite.node.ts` |
| `e84637783a` | 2026-10-11 | Child-process regression tests | `packages/core/test/database-write-hold.test.ts`, `test/fixture/sqlite-write-hold-child.ts` |

## Verification

- `bun test test/database-write-hold.test.ts` in `packages/core` - 7 pass on
  `sqlite-hold-log` (upstream `v1`) and on `dev-nowaker`: a child holding
  `BEGIN IMMEDIATE` 5s at a 200ms threshold logs `crossed` with its pid,
  session id, operation and statement while the scratch DB is still locked,
  then `released` with the total; deferred holds start at the first write;
  short holds and threshold `0` log nothing; a long autocommit insert logs
  `statement`; a `BEGIN` that waited 400ms on another process and failed logs
  nothing (fails before the fix, passes after).
- `bun typecheck` clean in `packages/core` and `packages/opencode`.
- Database tests (`database-acquisition`, `database-transaction`,
  `event-contention`, `database-write-hold`) - 33 pass on `dev-nowaker`.
- Full `packages/core` suite: the same 11 failures with and without the change
  on `v1` (tests that expect a non-git temp dir). On `dev-nowaker`,
  `DatabaseMigration > serializes concurrent embedded initialization` and
  `processor halt preserves bounded diagnostics for acquire failures` also time
  out on the untouched base `69ec5e063c`.
- Real line from the child, Bun runtime:
  `sqlite.hold.event=released sqlite.hold.pid=2960392 sqlite.hold.process=bun sqlite.hold.command=default sqlite.hold.sessionID=ses_write_hold_child sqlite.hold.operation=WriteHoldChild.hold sqlite.hold.statement="begin immediate" sqlite.hold.statements=3 sqlite.hold.since=2026-10-11T18:32:01.088Z sqlite.hold.holdMs=306 sqlite.hold.thresholdMs=100`

## Timeline

- 2026-10-11 [`ses_ed3cd4757ffe8sS7yvGpXbfu87`](../sessions/2026-10-11-sqlite-write-hold-log.md) -
  initial build, upstream PR #54580, installs on desktop and m4max
  (`1.19.0-vt-220-dfb56f76c7`).

## Current maintenance notes

- Read lines back with opencode-tools' `vibeterm-db-locks --at TIME`; it reads
  `opencode.log` and the toolset's events file with their archives.
- On an upstream bump, both runtime adapters' `run` and `runValues` must still
  pass every statement through `hold(fiber, query, ...)`, outside
  `SessionMaintenanceWrite.run`.
- The tracker reads `native.inTransaction` (Bun) / `native.isTransaction`
  (Node) after each statement; a runtime that drops either breaks hold
  detection silently.

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- Classify the customization as preserved, conflicted, superseded, or removed.
- Reverse any deliberate uncommitted patch before merging, then reapply its
  canonical patch afterward.
- Run `test/database-write-hold.test.ts` and `bun typecheck` in `packages/core`.
- Build through `.vibeterm/build.sh` and verify the installed binary.
- Confirm protected services kept the same PID and start timestamp.
- Link a new timeline row to the current session record.
- Update `Last checked against upstream`.
