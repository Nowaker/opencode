# Snapshot cleanup repair, op timing and oversize warning

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `snapshot-gc` (fork); `snapshot-gc-repair` (upstream v1 candidate, gc fix only)
- First local commit: `593d18abc2`
- Current local commit(s): `593d18abc2`, `72f013ccac`
- Upstream base when introduced: `dfb56f76c7` (upstream `v1`, contains `v1.19.0`)
- Last checked against upstream: `dfb56f76c7`

## Original request

Coordinator `ses_ef8235798ffejGr4sa22eXmVNv`:

> The user approved "Fix gc in opencode" for the snapshot store and asked for a size guard and timing data.

The user's comment, as relayed verbatim to the Vibeterm-side session:

> think of other solutions that could limit the size taken, e.g. snapshot max size, eg if snapshjot ends up really excessive (eg some shit binaries got into it, not properly gitignored), some action is taken, e.g. ai is vtps-ed about potentially incorrect git adds or something, and that it should screen it? also, measure how much wall clock time snapshots are taking on average, and some percentiles etc. so i can evaluate if i want this feature permanently off for us here in vt.

## Goals

- The hourly snapshot `git gc` succeeds on damaged stores instead of failing on every run.
- A failed or interrupted gc leaves no `objects/pack/tmp_*` of its own behind.
- A store keeps failing at most a few times a day: backoff doubles up to a day.
- Every snapshot op is timed in one parseable log line, and an oversized snapshot names its largest files.

## Non-goals

- Skipping oversized content: it is still recorded, so undo and revert keep working for it.
- Removing orphan stores or tmp files older than one run, the doctor row and the session alert: Vibeterm side (opencode-tools), not this fork.

## Rationale and constraints

- Desktop log had 600+ `cleanup failed` lines from two causes, both reproduced on copies of the live stores:
  - 104 zero-byte loose objects (all 2026-09-28) in the opencode-tools store: `object file ... is empty` / `unable to add cruft objects`. `git add` never rewrites a present-looking object, so the store never recovers.
  - An alternate whose repository (`dreamhost/damian-todo`) was deleted: `bad tree object`, because the index names trees that lived only there.
- The ai-api-usage-tracker store gc succeeds on a copy but takes over 20 s; every process opening that project runs cleanup one minute after start (384 instance creations in one log), so short-lived processes were killed mid-repack, leaving up to 650 MB `tmp_pack_*` several times a day.
- Only the run's own temp files are removed: it holds `gc.pid` while running, so no other git repacks the store meanwhile. Leftovers older than one run are the Vibeterm safety net's job.
- Upstream `v1` has the same cleanup code and the same failures: the five new cleanup tests fail on `v1` and pass with the fix.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `593d18abc2` | 2026-10-27 | Cleanup drops missing alternates, removes empty loose objects and retries, deletes its own tmp files on failure or interrupt, keeps a per-store schedule with backoff, skips a store another gc holds | `Snapshot` `cleanup`/`collect`/`gc`/`discard` in `packages/opencode/src/snapshot/index.ts`; `<store>/opencode-cleanup.json` |
| `72f013ccac` | 2026-10-27 | `snapshot op` line per track/patch/cleanup; `snapshot oversized` warning; `snapshot_oversize_bytes` config; optional `sessionID` on `track`/`patch` | `report`/`guard`/`add` in `snapshot/index.ts`; `snapshot_oversize_bytes` in `packages/core/src/v1/config/config.ts`; `SessionProcessor`, `SessionRevert` call sites |

Log contract parsed by Vibeterm (logfmt from `packages/core/src/observability/logging.ts`; values with spaces, `=`, `"` or `\` are JSON-quoted):

- `message="snapshot op" op=track|patch|cleanup [sessionID=<id>] duration_ms=<int> files=<int> added_bytes=<int> store=<project-id>/<worktree-hash> ok=true|false [result=collected|scheduled|busy|failed]`
- `level=WARN message="snapshot oversized" op=track|patch [sessionID=<id>] store=<...> files=<int> added_bytes=<int> threshold_bytes=<int> top=<path:bytes,...>` (at most 10, worktree-relative, largest first)
- `sessionID` is absent for cleanup and for callers that pass none (`opencode debug snapshot`). `result` is cleanup-only. No line is logged when snapshots are disabled or the store does not exist.
- `duration_ms` includes the wait for the per-store lock. `files`/`added_bytes` are the paths that call staged and their on-disk size, not compressed object bytes.

## Verification

- `bun run test test/snapshot/` in `packages/opencode` - 67 pass, 0 fail. The five cleanup tests fail on the pre-fix code (0 pass, 5 fail).
- `bun typecheck` in `packages/opencode` and `packages/core` - clean. SDK regeneration is a no-op on a second run.
- Installed binary, scratch XDG dirs: `debug snapshot track` / `patch` log `snapshot op` and `snapshot oversized` lines; `opencode serve` with fresh copies of the two failing stores logged `dropped missing snapshot alternates` then `result=collected`, and `removed empty snapshot objects count=104` then `result=collected` after 11.8 s; the 1.5 GB store became 55 MB, no `tmp_` files, manual gc exits 0.

## Timeline

- 2026-10-27 [`ses_e8079207bfferzKUfQEvpgORlL`](../sessions/2026-10-27-snapshot-housekeeping.md) - initial build. Evidence: `593d18abc2`, `72f013ccac`; vt-376 on desktop and m4max.

## Current maintenance notes

- `593d18abc2` is upstreamable on its own; the candidate is `Nowaker:snapshot-gc-repair` (`b7a47beca1`) with issue anomalyco/opencode#59766. The PR could not be created (see the session record).
- `72f013ccac` is fork-only. When `593d18abc2`'s upstream equivalent lands, keep `report`/`guard` on top of upstream's `cleanup`.

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- Classify the customization as preserved, conflicted, superseded, or removed.
- Reverse any deliberate uncommitted patch before merging, then reapply its canonical patch afterward.
- Regenerate derived clients or schemas instead of editing generated files.
- Run the feature's focused tests and affected package typechecks.
- Build through the host's canonical installer and verify the installed binary.
- Confirm protected services kept the same PID and start timestamp.
- Link a new timeline row to the current session record.
- Update `Last checked against upstream`.
