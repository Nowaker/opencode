# Concurrent fresh-database initialization fix

## Identity

- Workday: 2026-10-16
- Session: `ses_eb8582f68ffeUwFYhDGSv6jx7B`
- Agent/platform: `Sisyphus - ultraworker` (anthropic/claude-opus-5-5) / linux, plus m4max (darwin-arm64) over SSH
- Repository: `~/projekty/webapps/opencode` (desktop), `~/projects/webapps/opencode` (m4max)
- Integration branch: `dev-nowaker`
- Development branch(es): `fresh-db-race` (worktree `.vibeterm/worktrees/fresh-db-race` on both hosts)
- Upstream base: `dev-nowaker` at `c459e6157b`
- Source result commit(s): `69d1db22c9`, `ecce854f45` (test-only)
- Forklog commit: this file's introducing commit

## User requests

From the fork TUI coordinator `ses_ef8235798ffejGr4sa22eXmVNv` for the m4max requester `ses_ece7ebee8ffe22WteQOpV40i62`:

> A bounded, user-approved engine fix. [...] a narrow engine fix, diagnosis of the managed opencode fork, a minimal fix for fresh-database initialization, and isolated CLI/TUI regressions. NOT approved: unrelated upgrades, pushes, live installs, or restarts of any server or TUI.

## Goals

- Diagnose and fix concurrent first opens of a fresh database, with failing-before and passing-after tests and isolated builds on desktop and m4max.

## Constraints and non-goals

- Migrations and the v1/v2 migration guard unchanged.
- No push, no merge into `dev-nowaker`, no live install, no restart of any server or TUI.
- No pre-initialized profiles, serialized fixture launches, test-only init path, or timeout/assertion changes to existing tests.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| desktop opencode | `fresh-db-race` | `931f3a854a` (cut from dev-nowaker) | `69d1db22c9` + this forklog commit | commit, rebased onto `c459e6157b` |
| m4max opencode | `fresh-db-race` | absent | `69d1db22c9` | fetched from a git bundle; m4max checkout stayed on `dev-nowaker` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Concurrent first open of a fresh database](../features/2026-10-16-fresh-db-concurrent-init.md) | introduced | `69d1db22c9`, verification below |

## Other delivered work

- None.

## Verification

Sanitized SQLite causes, captured from the real `Database.layerFromPath` in concurrently released processes:

- `PRAGMA journal_mode = WAL` - `SQLITE_BUSY`, errno 5, `database is locked` (before busy timeout; and on m4max after it, from the read-to-write upgrade).
- `CREATE TABLE \`workspace\`` - `SQLITE_ERROR`, errno 1, `table \`workspace\` already exists`.

Commands and results:

- `bun test test/database-migration.test.ts -t "concurrent processes"` (packages/core): fails on the base; fails 1/3 on m4max with only the pragma reorder and IMMEDIATE schema decision; passes on desktop and 5/5 on m4max at `69d1db22c9`.
- `bun test test/database-migration.test.ts` (packages/core): 19 pass, 1 fail. The failure is `serializes concurrent embedded initialization for one database path` timing out at 5000ms; it fails identically on the unmodified base (`begin immediate` SQLITE_BUSY after the 5s busy timeout).
- Database suites `database-acquisition`, `session-maintenance-{emergency,migration,process,runtime}`, `event-contention`, `transaction-diagnostic`: 26 pass, 0 fail.
- Full `packages/core` suite (earlier tree): 1191 pass, 23 fail; the failures that touch these files (WriteHold timing, WebFetch, ProjectCopy, the embedded-init test) also fail on the base; the rest (npmrc, ripgrep, non-repository search, ProjectV2 non-git, Snapshot) are environment-dependent and untouched by this change.
- `bun typecheck` in `packages/core` and `packages/opencode`: exit 0.
- Migration sources: `git diff dev-nowaker..HEAD -- packages/core/src/database/migration/ migration.gen.ts schema.gen.ts schema.sql.ts` is empty.
- Concurrent `opencode db "SELECT 1 AS ok"` against one fresh scratch data dir (scratch XDG_*, OPENCODE_TOOLS_DATA_DIR, OPENCODE_PLUGINS_DATA_DIR):
  - desktop live vt-333: N=2 10/10 rounds failed; live vt-343 (another session installed `c459e6157b` at 22:54 local, before this run): N=2 4/10, N=4 8/10; isolated `69d1db22c9`: N=2 0/20, N=4 0/20.
  - m4max live vt-343: N=2 7/10, N=4 9/10; isolated `69d1db22c9`: N=2 0/20, N=4 0/20.
- Two cold TUIs on a throwaway tmux socket against one fresh data dir:
  - desktop live vt-340: 2/5 rounds (pane exited 1), 3/12 rounds (`Error: Failed query:` on screen); isolated: 0/12.
  - m4max live vt-343: 0/12 at 8s settle, 2/20 at 6s settle (pane exited 1); isolated: 0/20 at 6s settle.

## Build and install

- Build command: `OPENCODE_SRC=<worktree> OPENCODE_INSTALL=<worktree>/tmp/isolated/opencode VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard <worktree>/.vibeterm/build.sh` on each host (m4max PATH adds `/opt/homebrew/lib/node_modules/npm/bin/node-gyp-bin` for `bun install`).
- Installed artifact: not installed. Isolated `1.19.0-vt-344-dfb56f76c7` - desktop sha256 `7e1d4516ca082f0d3f8f1341e7e06c1f9c1ddd4825822cfc709bf60e82024dbc`, m4max sha256 `a50620626c117d9e66549c79994013a44b57cbfa4bfb972e69a6ec3f596b614c`. Both lack the deliberately uncommitted retry-header cap, which lives only in each primary checkout.
- v2 guard gate: PASSED on both hosts (desktop against opencode-ai@1.19.3 / @opencode/cli@2.0.32; m4max against cached opencode-ai@1.19.0 / @opencode/cli@2.0.29).
- Running services: not touched; each live binary's sha256 was the same before and after every isolated build (desktop `e6339fcb...` vt-343 around the final build, m4max `82b93479...` vt-343).

## Parent gate finding (2026-10-17, same workday)

The m4max parent rejected `b94d8e9438` on one test-resource finding from its independent reviewer: the multi-process test spawned four children without cleanup, asserted readiness before closing stdin and had no readiness or completion deadline, so an early-exiting child left its siblings blocked in `Bun.stdin.text()` and a stalled child outlived the 90s timeout. The runtime algorithm was approved.

- `ecce854f45` - test-only: `openConcurrently` owns each child from spawn, bounds readiness and completion by one deadline (80s inside the unchanged 90s budget), and its finally block cancels readers, SIGKILLs survivors and awaits every child before returning. The fixture gains `exit-before-ready` and `stall` modes; two tests drive the real harness with one such child among three normal ones.
- Old harness, same fixture modes (`packages/core/tmp/old-harness-leak.ts`, scratch): exit-before-ready rejected and left 3 of 4 children alive; stall never settled and left the stalled child alive. Same on desktop and m4max; the scratch driver then killed them.
- New harness: exit-before-ready child exited 3 and the other three were SIGKILLed; stall child SIGKILLed at the deadline and the other three exited 0; `kill(pid, 0)` fails for all eight; no fixture process remains.
- `bun test test/database-migration.test.ts -t "concurrent processes|concurrent-open harness"`: 3 pass on desktop, 3/3 runs on m4max. Full file: 21 pass, 1 fail (the pre-existing embedded-init timeout). `bun typecheck` (core) exit 0 on both hosts.
- `git diff 69d1db22c9 -- packages/core/src packages/opencode/src` is empty, so the isolated binaries were not rebuilt: desktop `7e1d4516...`, m4max `a50620626c...`, both unchanged.

## Commit provenance

- `69d1db22c9` - fix(core): initialize a fresh database safely from concurrent processes
- `ecce854f45` - test(core): own every child of the concurrent fresh-database test
- Required trailer: `AI-Session-ID: ses_eb8582f68ffeUwFYhDGSv6jx7B`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-16-fresh-db-concurrent-init.md
```

## Historical evidence carried forward

- None.

## Unknowns and blocked verification

- Landing, the live install and upstream submission are left to the coordinator after the requester accepts.
