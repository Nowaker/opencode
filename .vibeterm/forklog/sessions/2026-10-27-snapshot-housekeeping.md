# Snapshot cleanup repair, op timing and oversize warning

## Identity

- Workday: 2026-10-27
- Session: `ses_e8079207bfferzKUfQEvpgORlL`
- Agent/platform: opencode (anthropic/claude-opus-5-5) / linux
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `snapshot-gc`; `snapshot-gc-repair` (off upstream `v1`)
- Upstream base: `dfb56f76c7` (upstream `v1`, contains `v1.19.0`); fork tip before `0d247b9f77`
- Source result commit(s): `593d18abc2`, `72f013ccac`
- Forklog commit: this file's introducing commit

## User requests

Coordinator `ses_ef8235798ffejGr4sa22eXmVNv`; quoted in [the feature record](../features/2026-10-27-snapshot-housekeeping.md#original-request).

## Goals

- Root-cause and fix the failing snapshot gc and its `tmp_pack` leak; add a size guard and timing lines under a binding log contract for the Vibeterm side.

## Constraints and non-goals

- Live stores were never modified: every reproduction ran on copies under `.vibeterm/tmp/opencode/`.
- Guard and timing stay fork-only; only the gc fix goes upstream.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| opencode fork | `dev-nowaker` | `0d247b9f77` | `72f013ccac` | fast-forward from `snapshot-gc`, pushed to `origin` |
| opencode fork | `snapshot-gc-repair` | - | `b7a47beca1` | cherry-pick of `593d18abc2` onto `github/v1`, no AI trailers, pushed to `nowaker-github` |

`nowaker-github/dev-nowaker` rejected the push (non-fast-forward): it still holds the three Mark Brown commits that wait on `qst_165dd818d001UFatCmA3wlhlks`.

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Snapshot cleanup repair, op timing and oversize warning](../features/2026-10-27-snapshot-housekeeping.md) | introduced | tests and real run in the feature's Verification |

## Other delivered work

- Upstream issue anomalyco/opencode#59766 filed. `gh pr create` for `Nowaker:snapshot-gc-repair` against `v1` failed for both credentials: `Nowaker does not have the correct permissions to execute CreatePullRequest` (gh OAuth login) and `Resource not accessible by personal access token` (env PAT). Nowaker has 34 open PRs upstream; other `NONE`-association authors opened 32 PRs since 10-18, so a per-contributor limit is the likely cause (unconfirmed).

## Verification

- See the feature's Verification.
- Neighbouring suites: `test/session/revert-compact`, `summary-events`, `processor-effect`, `test/server/project-init-git`, `test/config/config` - 143 pass, 3 fail; `project-init-git` and one config failure come from `TMPDIR` inside a git repo and pass with `TMPDIR=/tmp`; `creates global jsonc config with schema when no global configs exist` fails identically on base `0d247b9f77`.
- Upstream branch: `bun run test test/snapshot/` 60 pass; typecheck clean.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard ./.vibeterm/build.sh` from the primary checkout on desktop and m4max.
- Installed artifact: `1.19.0-vt-376-dfb56f76c7` on desktop (inode 49945228) and m4max; retry marker present on both; v2 migration guard gate PASSED on both.
- Running services: not restarted.

## Commit provenance

- `593d18abc2` - fix(opencode): keep snapshot cleanup from failing and leaking packs
- `72f013ccac` - feat(opencode): time every snapshot op and warn on oversized snapshots
- Required trailer: `AI-Session-ID: ses_e8079207bfferzKUfQEvpgORlL`

## Unknowns and blocked verification

- Upstream PR not created; branch and issue are public.
- No `snapshot op` line with `sessionID` was observed from a real model turn (no provider in scratch); the processor wiring is covered by typecheck only, the field by unit tests.
