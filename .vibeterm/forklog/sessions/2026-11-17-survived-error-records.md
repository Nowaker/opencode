# Stacks for logged errors and records of survived ones

## Identity

- Workday: 2026-11-17
- Session: `ses_e137ec059ffeNznucjtDVhy7sE`
- Agent/platform: `opencode (Sisyphus, anthropic/claude-opus-5-5)` / `darwin` (m4max)
- Repository: `Nowaker/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `survived-error-records`
- Upstream base: `006d837c50`
- Source result commit(s): `9ca01fdf5c`
- Forklog commit: this file's introducing commit

## User requests

> Build the item-3 proposal from your crash-report work: errors opencode survives go to GlitchTip with stack frames.

## Goals

- See [the feature](../features/2026-11-18-survived-error-records.md).

## Constraints and non-goals

- Fast-forward/merge only on `dev-nowaker`; push to both remotes; build only through `.vibeterm/build.sh`, one host at a time, behind the memory gate.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `Nowaker/opencode` | `dev-nowaker` | `a59ae25916` | `9ca01fdf5c` | fast-forward |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Stacks for logged errors and records of survived ones](../features/2026-11-18-survived-error-records.md) | new | 19 core tests, scratch TUI record |

## Verification

- `bun test test/effect/observability.test.ts test/observability/` (packages/core) - 19 pass, 0 fail.
- `bun typecheck` (packages/core, packages/opencode) - clean.
- opencode-tools `_lib/opencode-errors/real-opencode.test.ts` against the installed build - 1 pass: one event for the survived record, one for a stacked log line, none for a noise line.

## Build and install

- Build command: `bash .vibeterm/build.sh` (m4max from the worktree; desktop from its own checkout after fast-forward), v2 guard gate passing.
- Installed artifact: `1.19.5-vt-529-006d837c50` on m4max and desktop; `grep -c -a OPENCODE_RETRY_MAX_HEADER_DELAY_MS` = 1 on both.
- Running services: none restarted; running TUIs pick it up on their next restart.

## Commit provenance

- `9ca01fdf5c` - feature.
- Required trailer: `AI-Session-ID: ses_e137ec059ffeNznucjtDVhy7sE`

## Historical evidence carried forward

- None.

## Unknowns and blocked verification

- None.
