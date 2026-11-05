# Async snapshot reliability check, 3 days after install

## Identity

- Workday: 2026-11-05
- Session: `ses_e552a0970ffenpqGnyRp4OwJE1` (spawned by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`)
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (`high`) / `linux`
- Repository: `~/projekty/webapps/opencode`; m4max `~/projects/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `snapshot-reliability` (forklog only, cut from `dev-nowaker` `4b2e45fbf9`)
- Upstream base: `006d837c50` (`v1.19.5`)
- Source result commit(s): none
- Forklog commit: this file's introducing commit

## User requests

Relayed by the coordinator, which recorded the request from 2026-11-02:

> Reliability check, requested by the user on 2026-11-02: are opencode's async per-step snapshots behaving, 3 days after install? Read-only unless you find a regression.

## Goals

- Compare logs and DB rates before and after async snapshots on desktop and m4max, find user reports, compare time to the first model request, and list processes on binaries older than vt-391.

## Constraints and non-goals

- Read-only: no restarts of tabs, the Vibeterm tmux server, Meridian or services. Indexed DB queries only, counts only, no message text.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `4b2e45fbf9` | this record's commit | fast-forward from `snapshot-reliability`; pushed to `origin` and `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Send the model request while file snapshots run](../features/2026-11-01-async-snapshots.md) | re-verified, reliable | [Reliability check 2026-11-05](../features/2026-11-01-async-snapshots.md#reliability-check-2026-11-05) |

## Other delivered work

- None.

## Verification

- Desktop logs: 495,449 snapshot, loop and stream lines from 2026-10-29 to 2026-11-05 08:35Z; zero `snapshot failed`, zero revert or restore lines.
- Desktop DB: 14 twelve-hour chunks, each under 3.1 s, with `EXPLAIN QUERY PLAN` showing `vt_message_time_created_id_idx` and `part_message_id_id_idx`.
- m4max: log counts computed on the host; three bounded 6-hour DB queries on `vt_message_time_created_id_idx`.
- `second_brain_search` and `second_brain_find` since 2026-11-02 for undo, revert, Modified Files, missing diffs and snapshots: no user report.
- Raw `git diff-files` and `ls-files --others` on this repository's snapshot store: 4-9 ms.

## Build and install

- Build command: not run
- Installed artifact: unchanged, `1.19.5-vt-399-006d837c50` on both hosts (desktop inode 49970241, m4max inode 53817024)
- Running services: not touched

## Commit provenance

- No source commit.
- Required trailer: `AI-Session-ID: ses_e552a0970ffenpqGnyRp4OwJE1`

The record cannot contain its own eventual commit hash. Resolve it with:

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-11-05-async-snapshot-reliability.md
```

## Historical evidence carried forward

- None.

## Unknowns and blocked verification

- `waitForSnapshots` time is not logged; the DB proxy compares tool start with the step-start hash write.
- m4max window B has 14 logged tracks, too few to compare.
- Which sessions the stale m4max `opencode serve` (PID 85515) serves: TBD.
