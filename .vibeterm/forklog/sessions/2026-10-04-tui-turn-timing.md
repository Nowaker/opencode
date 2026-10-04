# Per-turn completion time and duration in the TUI

## Identity

- Workday: 2026-10-04
- Session: `ses_ef81c1485ffeC5Sb59U9mVI77g`
- Agent/platform: `Sisyphus - ultraworker` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-turn-timing` (worktree under `.vibeterm/worktrees/`, off upstream `dev` `907b3bc518`); landing worktree `tui-turn-timing-land` off `dev-nowaker` `35bba9112a`
- Upstream base: `907b3bc518` (upstream `dev`); unchanged
- Source result commit(s): `17dca85fb5` (cherry-pick of `2fda6d8d7a` on `tui-turn-timing`)
- Forklog commit: this file's introducing commit

## User requests

Spawned by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` as effort item 3
("opencode TUI improvements"), quoting the user:

> each ai turn should show time (if today), datetime (if not today) and how
> long it took (e.g. 2h3m). additionally, final ai messages (after a series of
> turns), should have both the time it took to generate final response AND the
> entire interaction since the prompt that triggered this turn. configurable in
> tui and in /tui commands. defaults: matching current defaults, whatever they
> are.

## Goals

- Per-turn completion time and duration, final turn also showing the total.
- `tui.json` option plus runtime slash/palette toggles; defaults unchanged.
- Same change offered upstream.

## Constraints and non-goals

- Vanilla defaults documented first: `/timestamps` (kv `timestamps`, default
  `hide`) shows times on user messages only; the assistant footer
  (`▣ Mode · model · total`) appears only on the last/final/interrupted
  message, with the total since the prompt.
- Landed only after the reintegration session
  `ses_ef81db9cdffe5vRz7Y2HqCmvNs` declared `dev-nowaker` final.
- No TUI tab or vibeterm tmux server restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `35bba9112a` | `17dca85fb5` + this forklog commit | cherry-pick from `tui-turn-timing` (conflicts with `keep_scroll_on_submit` resolved by keeping both), fast-forward; pushed to `origin` and `nowaker-github` |
| `opencode` (GitHub fork) | `tui-turn-timing` | - | `2fda6d8d7a` | new branch off upstream `dev` `907b3bc518`; head of PR #53195 |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Per-turn completion time and duration in the TUI](../features/2026-10-04-tui-turn-timing.md) | introduced | typecheck; config test; before/after tmux frames |

## Other delivered work

- Upstream issue [#53192](https://github.com/anomalyco/opencode/issues/53192)
  (issue-first policy; related #43243, #35348) and PR
  [#53195](https://github.com/anomalyco/opencode/pull/53195).

## Verification

- `bun typecheck` in `packages/tui` and `packages/opencode` - exit 0 on both
  branches.
- `packages/opencode/test/config/tui.test.ts` - 30 pass, 4 fail; the same 4
  plugin-merge tests fail on pristine `907b3bc518` (29 pass without the new
  test). `packages/tui/test/config.test.tsx` - 9/9.
- Manual surface: see the feature record; vanilla and patched-default frames
  identical, both toggles, time-only, and `tui.json` default checked.

## Build and install

- Recorded by this session's follow-up forklog commit, after the build on
  both hosts.

## Commit provenance

- `17dca85fb5` - TUI change, docs, config test.
- Required trailer: `AI-Session-ID: ses_ef81c1485ffeC5Sb59U9mVI77g`

## Unknowns and blocked verification

- `/tmp` is a nearly full tmpfs with a user quota; zsh heredocs there failed
  with "disk quota exceeded" and left empty files. Scratch moved into the
  worktree's `tmp/`.
