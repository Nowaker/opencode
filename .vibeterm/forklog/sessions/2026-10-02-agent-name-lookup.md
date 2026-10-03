# `opencode run --agent plan` fails on a renamed agent

## Identity

- Workday: 2026-10-02
- Session: `ses_f011ccc18ffeZAKpRC9OjZ40a8`
- Agent/platform: `Sisyphus - ultraworker` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `agent-name-lookup` (worktree under `.vibeterm/worktrees/`)
- Upstream base: `2fa3363c92` (upstream `dev`, contains `v1.18.33`); unchanged
- Source result commit(s): `d6665aba3d`
- Forklog commit: this file's introducing commit

## User requests

Spawned by Meridian coordinator `ses_fe8a27c6effe6KEx3TRNvOLgUo`, condensed:

> on desktop's opencode 1.18.33-vt-55-2fa3363c92, `opencode run --agent plan
> "<prompt>"` fails with `UnknownError err_e1331eaa`, and nothing is logged
> under that ref. [...] Find the root cause, and why the error ref has no log
> line. [...] Also make the error reach the log, if that is a fork-side gap.

## Goals

- `opencode run --agent plan` works with the user's config.
- Explain the missing log line.

## Constraints and non-goals

- No opencode process restarted; the coordinator schedules restarts.
- The user's config is left unchanged.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `622675ccd7` | `d6665aba3d` | fast-forward from `agent-name-lookup`; pushed to `origin` and `nowaker-github` |
| `opencode` (m4max) | `dev-nowaker` | `622675ccd7` | `d6665aba3d` | fast-forward from `origin` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Agent lookup by configured name](../features/2026-10-02-agent-name-lookup.md) | introduced | agent test; desktop live run |

## Other delivered work

- Diagnosis of the missing log line, upstream behaviour, not fixed here: the
  file logger is Effect's `Logger.toFile`, which buffers lines and writes them
  from a detached `sleep(1s) -> flush` loop, with the final flush as a scope
  finalizer. `src/index.ts` ends every command with `process.exit()` in
  `finally` without disposing a runtime, so whatever is buffered is dropped.
  Runs that spend their last seconds without a timer turn lose all of it: from
  a fresh `git init` repo or from opencode-tools, failing `vt-55` runs logged
  nothing after `Ignoring MCP config entry`, about 3 s before the error, in 8
  of 8 runs (6 with isolated XDG dirs, 2 with the real ones). From inside this
  repository the ref was logged in 13 of 13 runs. That matches the original
  report: the 21:47 migration runs ran from `opencode-tools/tmp/`. Upstream
  `dev` has the same `finally`.

## Verification

- `bun test test/agent/agent.test.ts` - 44 pass; the new test fails without
  the fix.
- `bun typecheck` in `packages/opencode` - exit 0.
- `bun test test/session/prompt.test.ts test/tool/task.test.ts` - 80 pass, 1
  pre-existing fail ("drops an interrupted trailing assistant ...", timeout;
  same result without the fix).
- Isolated repro harness (separate XDG dirs, config dir read-only): `vt-55`,
  `vt-53` and stock 1.18.33 fail with `Agent not found: "OC-Plan"`; `vt-57`
  exits 0 with `PONG`.
- Manual surface, desktop real config and data: `opencode run --agent plan`
  on `vt-57` -> `PONG`, session `ses_f00f12683ffesLGSvwjEJZge60`.

## Build and install

- Build command: `.vibeterm/build.sh` on desktop and m4max.
- Installed artifact: `1.18.33-vt-57-2fa3363c92` on both; desktop inode
  `49977842`; retry-header marker present on both.
- Running services: none restarted.

## Commit provenance

- `d6665aba3d` - fix and regression test.
- Required trailer: `AI-Session-ID: ses_f011ccc18ffeZAKpRC9OjZ40a8`

## Unknowns and blocked verification

- m4max: `opencode run` hangs until `timeout` (exit 124) with or without
  `--agent`, on both `vt-55` and `vt-57`. The log stops after `shell tool using
  shell`. That predates this change and is not diagnosed here. m4max's config
  does not rename `plan`, so the defect itself never applied there.
