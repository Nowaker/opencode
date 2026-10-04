# Reopen opencode.log after an external rotation

## Identity

- Workday: 2026-10-03
- Session: `ses_efb698c02ffefXlxsxKlISKpRH`
- Agent/platform: `Sisyphus - ultraworker` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `log-reopen` (worktree under `.vibeterm/worktrees/`, off upstream `dev` `907b3bc518`)
- Upstream base: `2fa3363c92` (upstream `dev`, contains `v1.18.33`); unchanged
- Source result commit(s): `d1442208f5` (cherry-pick of `7724dab730` on `log-reopen`)
- Forklog commit: this file's introducing commit

## User requests

Spawned by opencode-tools coordinator `ses_efbf81be2ffeOUhnv0uLJM0Jog`, condensed:

> Task, approved by the user: make opencode reopen its log file when an
> external rotator renames it. Fork change on `dev-nowaker` plus an upstream
> PR. This is now urgent. opencode-tools' retention-clean went live at 23:29
> and rotates `opencode.log` by RENAME. [...] Verify with the installed
> binary [...] When done, reply with [...] the fork sha, the upstream PR URL
> and the installed build's version stamp.

## Goals

- Rename-based rotation of `opencode.log` loses nothing.
- Same change offered upstream.

## Constraints and non-goals

- No change to log format, location or level handling.
- No user TUI or vibeterm tmux server restarted; no `opencode-serve-*`
  unit restarted either.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `2c4830012d` | `d1442208f5` | cherry-pick from `log-reopen`; pushed to `origin` and `nowaker-github` |
| `opencode` (GitHub fork) | `log-reopen` | - | `7724dab730` | new branch off upstream `dev` `907b3bc518`; head of PR #53090 |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Reopen opencode.log after an external rotation](../features/2026-10-03-log-reopen.md) | introduced | observability tests; isolated serve `mv`/`rm` check |

## Other delivered work

- Upstream issue [#53089](https://github.com/anomalyco/opencode/issues/53089)
  (required by upstream's issue-first policy) and PR
  [#53090](https://github.com/anomalyco/opencode/pull/53090). Related
  upstream: #47133 (unbounded `opencode.log`); #47676 added in-place trimming
  on the `v2` branch only.

## Verification

- `bun test test/effect/observability.test.ts` in `packages/core` - 8 pass on
  both branches; rename and delete tests fail against upstream `logging.ts`.
- `bun typecheck` in `packages/core` - exit 0.
- Manual surface: installed binary, isolated XDG dirs, `opencode serve` on
  127.0.0.1:4791. `mv opencode.log opencode.log.old` + requests -> `.old` 3
  lines (unchanged), new `opencode.log` 31 lines. `rm opencode.log` + request
  -> recreated with 10 lines, `.old` still 3.
- Observed: the serve process holds 2 log descriptors (one per runtime that
  provides `Observability.layer`); the idle one stayed on `.old` without
  writing to it. See the feature's rationale.

## Build and install

- Build command: `.vibeterm/build.sh` on desktop.
- Installed artifact: `1.18.33-vt-59-2fa3363c92`, inode `49955403`;
  retry-header marker present.
- Running services: none restarted.

## Commit provenance

- `d1442208f5` - fix and tests.
- Required trailer: `AI-Session-ID: ses_efb698c02ffefXlxsxKlISKpRH`

## Unknowns and blocked verification

- m4max not rebuilt in this session.
