# Concurrent first open of a fresh database

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `fresh-db-race`
- First local commit: `69d1db22c9`
- Current local commit(s): `69d1db22c9`
- Upstream base when introduced: `github/v1` as merged into `dev-nowaker` at `c459e6157b`
- Last checked against upstream: `c459e6157b` (dev-nowaker)

## Original request

From the fork TUI coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, on behalf of the m4max coordinator `ses_ece7ebee8ffe22WteQOpV40i62`, under user approval `qst_13ff177270015HR0ICpD07Bi0I`:

> A bounded, user-approved engine fix. [...] a narrow engine fix, diagnosis of the managed opencode fork, a minimal fix for fresh-database initialization, and isolated CLI/TUI regressions. NOT approved: unrelated upgrades, pushes, live installs, or restarts of any server or TUI.

## Goals

- Two or more opencode processes (`opencode db` queries, cold TUIs) opening one brand-new database at the same time all start, and the database ends with every migration recorded once.

## Non-goals

- No migration, generated schema or migration-journal change.
- No change to the v1/v2 migration guard (`_vt_refuse_v2_migration`, `event.created`).
- No change to the in-process concurrency test `serializes concurrent embedded initialization for one database path`, which times out on the base too (see Verification).

## Rationale and constraints

Three races, each fatal to the losing process:

1. `sqlite.bun.ts` ran `PRAGMA journal_mode = WAL` straight after open, before `busy_timeout`, so the second opener got `SQLITE_BUSY` (errno 5) at once.
2. With the timeout in place, converting a rollback-journal file to WAL still reads the header under a read lock and then upgrades to a write lock; SQLite skips the busy handler on that upgrade to avoid deadlock. Every loser that read the old header gets `SQLITE_BUSY` immediately at `PRAGMA journal_mode = WAL` (observed on m4max, not on desktop).
3. `DatabaseMigration.apply` decided "empty" outside any transaction behind a process-local semaphore, then ran `schema.up` in a deferred transaction, so both processes created the schema and the loser failed with `SQLITE_ERROR` (errno 1) `table \`workspace\` already exists` - the m4max `CREATE TABLE workspace` symptom.

Only the WAL conversion is attempted again, and only for failures `SqliteFailure.parse(...).retryAcquisition` classifies as lock acquisition; the next attempt holds no read lock, so it waits through the busy timeout behind the converter. Any other error, or BUSY persisting for 20 attempts, still fails. The schema race is solved without a retry: the emptiness decision is repeated inside `BEGIN IMMEDIATE`.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `69d1db22c9` | 2026-10-16 | Busy timeout before WAL; WAL conversion waits behind a concurrent converter; schema creation decided under the write lock | `Database.layerFromPath` (`disableWAL: true`), `Database` layer pragmas, `DatabaseMigration.apply` |

## Verification

Recorded by `ses_eb8582f68ffeUwFYhDGSv6jx7B`; details in its [session record](../sessions/2026-10-16-fresh-db-concurrent-init.md#verification).

- `bun test test/database-migration.test.ts -t "concurrent processes"` (packages/core) - fails on the base (`table \`workspace\` already exists`, and `SQLITE_BUSY` at journal_mode before the pragma reorder); with only fixes 1 and 3 fails on m4max at `PRAGMA journal_mode = WAL`; passes with all three on desktop and 5/5 on m4max.
- Isolated binaries, concurrent `opencode db "SELECT 1 AS ok"` against one fresh scratch data dir: 0 failed rounds at N=2 and N=4 (20 rounds each) on both hosts; the live binaries failed 4/10 and 8/10 (desktop vt-340), 7/10 and 9/10 (m4max vt-343).
- Two cold TUIs on a throwaway tmux socket against one fresh data dir: live vt-340 desktop failed 2/5 and 3/12 rounds, live vt-343 m4max 2/20; isolated builds 0/12 (desktop) and 0/20 (m4max).
- `vibeterm-v2-guard gate --v1` (run by `.vibeterm/build.sh`) PASSED on both hosts.

## Timeline

- 2026-10-16 [`ses_eb8582f68ffeUwFYhDGSv6jx7B`](../sessions/2026-10-16-fresh-db-concurrent-init.md) - initial build. Evidence: `69d1db22c9`, isolated builds on desktop and m4max.

## Current maintenance notes

- On an upstream bump, inspect `packages/core/src/database/database.ts` (pragma order, `disableWAL`, WAL retry predicate) and `DatabaseMigration.apply`. Keep the multi-process test in `packages/core/test/database-migration.test.ts` with fixture `test/fixture/database-open.ts`.
- The interleaving that exposes race 2 shows up on m4max (darwin-arm64) far more than on desktop; run the multi-process test there when touching this seam.

## Supersession or removal

Not applicable.
