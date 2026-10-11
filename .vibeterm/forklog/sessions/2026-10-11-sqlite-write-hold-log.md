# 2026-10-11 - log which process holds the SQLite write lock too long

## Identity

- Workday: 2026-10-11
- Session: `ses_ed3cd4757ffe8sS7yvGpXbfu87`
- Agent/platform: Sisyphus (opencode, `anthropic/claude-opus-5-5`) / linux (desktop)
- Repository: `~/projekty/webapps/opencode` (desktop), `~/projects/webapps/opencode` (m4max)
- Integration branch: `dev-nowaker`
- Development branch(es): `sqlite-hold-log` (worktree `.vibeterm/worktrees/sqlite-hold-log`,
  upstream PR, cut from `github/v1`), `sqlite-hold-fork` (worktree
  `.vibeterm/worktrees/sqlite-hold-fork`, cut from `dev-nowaker`)
- Upstream base: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Source result commit(s): `e84637783a` on `dev-nowaker`; `4dda0c44e3` on `sqlite-hold-log`
- Forklog commit: this file's introducing commit

## User requests

Spawned by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 31, the user
approved "Add holder logging"):

> Every writer we control logs a warning when it holds a write transaction
> (or the write lock outside an explicit transaction, e.g. a long autocommit
> statement, checkpoint, vacuum, migration) longer than a threshold (~5 s;
> configurable via env) [...] Log once when the threshold is crossed (so a hold
> that never ends is still caught) and once at release with the total.

The same request covered opencode-tools writers and a reader; those landed in
opencode-tools `f0012a1` (`_lib/sqlite-write-hold`, `vibeterm-db-locks`).

## Goals

- opencode's connection logs its long holds; an upstream PR against `v1`;
  installs on desktop and m4max.

## Constraints and non-goals

- Build only through `.vibeterm/build.sh` with the v2 guard gate.
- Do not restart tabs; the protected serve units stay up.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| OpenCode | `sqlite-hold-log` | - | `4dda0c44e3` | feature commit on `github/v1`, pushed to `nowaker-github` |
| OpenCode | `dev-nowaker` | `10427099f1` | `e84637783a` | cherry-pick of the feature onto `927f4315a3` (conflicts with the retired-session write retry resolved by wrapping it), rebased onto `10427099f1`, ff-merged, pushed to `origin` and `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Log which process holds the SQLite write lock too long](../features/2026-10-11-sqlite-write-hold-log.md) | new | child-process tests, installed binaries |

## Other delivered work

- Upstream PR [anomalyco/opencode#54580](https://github.com/anomalyco/opencode/pull/54580), base `v1`.
- opencode-tools `f0012a1`: the same logging for every toolset writer of
  opencode.db, the machine-wide events file and `vibeterm-db-locks`.

## Verification

- See the feature record: 7 focused tests pass on both bases, `bun typecheck`
  clean, database tests 33 pass, full-suite failures unchanged from the bases.
- The regression for a failed `BEGIN` came from the full `dev-nowaker` run,
  where a busy wait was misreported as a hold; it fails before the fix.

## Build and install

- desktop: `.vibeterm/build.sh` at `e84637783a`; gate PASSED
  (2026-10-11T18:57:54Z); installed `1.19.0-vt-220-dfb56f76c7`, inode
  49952717 -> 49952718; binary carries `OPENCODE_SQLITE_WRITE_HOLD_WARN_MS` and
  the retry marker `OPENCODE_RETRY_MAX_HEADER_DELAY_MS`.
- m4max: fast-forwarded to `e84637783a`, retry patch matched the canonical
  patch; gate PASSED (2026-10-11T18:58:35Z); installed
  `1.19.0-vt-220-dfb56f76c7` (inode 30186904), both markers present.
- desktop protected services not restarted: `opencode-serve-tailscale` PID
  1994449 and `opencode-serve-lan` PID 1998763, both started 05:45 CDT.
- Noise check 18:58Z-20:03Z on desktop: 10 opencode processes on the new
  binary, the restarted collector and vibeterm-api; `vibeterm-db-locks` and a
  grep of `opencode.log`, `collector.log` and the units' journal found no hold
  line. A deliberately held scratch `opencode.db` (opencode-tools probe, 8s
  synchronous `BEGIN IMMEDIATE`) was reported `crossed` at 5.0s and
  `released` at 8.0s.

## Commit provenance

- `e84637783a` - feature on `dev-nowaker`
- `4dda0c44e3` - the same change on `github/v1` for the PR
- Required trailer: `AI-Session-ID: ses_ed3cd4757ffe8sS7yvGpXbfu87`

## Unknowns and blocked verification

- The 2026-10-06 and 2026-10-09 holders predate this logging and stay unknown.
