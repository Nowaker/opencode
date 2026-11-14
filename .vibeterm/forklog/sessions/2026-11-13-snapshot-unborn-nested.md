# Snapshot with a nested repository that has no commit

## Identity

- Workday: 2026-11-13
- Session: [`ses_e284adde6ffe1ycvQIhjknnH3s`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e284adde6ffe1ycvQIhjknnH3s) (spawned by coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv); build slots from [`ses_e383ee7faffe6JX8m2EP26dXUC`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e383ee7faffe6JX8m2EP26dXUC))
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (`high`) / `linux`
- Repository: `~/projekty/webapps/opencode`; m4max `~/projects/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `snapshot-unborn-nested`; upstream twin `snapshot-unborn-upstream`
- Upstream base: `006d837c50` (`v1.19.5`); upstream twin cut from `github/v1` `acc8c26da4`
- Source result commit(s): `73e9e8b28e` (fast-forward); upstream twin `d8087e0352`
- Forklog commit: this file's introducing commit

## User requests

From the coordinator:

> BUG in the opencode fork (v1, branch dev-nowaker): when a project directory contains a nested git repository whose branch has no commits yet, every snapshot `git add` in that project fails, so the session gets no snapshots/diffs/reverts there. [...] 1. Reproduce with a test in packages/opencode (snapshot module) first [...] Watch it fail. 2. Fix in the snapshot code: a nested repo without a HEAD must not fail the whole add (skip it or add it as plain files, whichever matches how the snapshot already treats nested repos that DO have commits; check upstream snapshot behaviour and any open anomalyco/opencode issue/PR on it first). [...] 5. Add a forklog session record under .vibeterm/forklog/sessions/ and a ready-to-file PR entry in .vibeterm/forklog/pr-queue/ (do NOT open the upstream PR; the 3-PR cap is full). 6. Verify in the real demos directory: after installing, a snapshot in a fresh tab there succeeds.

## Goals

- A nested repository with no commit no longer fails the snapshot `git add` for the whole worktree; nested repositories with a commit stay gitlinks.

## Constraints and non-goals

- No upstream PR opened (3-PR cap); `pr-queue/06-snapshot-unborn.md` holds the ready body.
- W4's scratch `tmp/w4-proof-FFDPTt/project` in `opencode-omo-demos` (the live trigger) was not touched.
- The main checkouts' uncommitted retry-header cap and `.gitignore` edit were preserved, so vt-474 carries the cap.

## Root cause and choice

- `ls-files --others` reports a nested repository as a directory entry (`sub/`), and the snapshot stages it as a gitlink. With no HEAD, git exits 128 for the whole batch, staging nothing.
- `add()` now checks each candidate directory with its own `.git` via `git --git-dir <dir>/.git rev-parse --verify --quiet HEAD` and leaves out only HEAD-less ones. A gitlink holds none of the nested files anyway, so skipping matches how committed nested repositories are treated. The `index.lock` retry and the async snapshot path are unchanged.
- Upstream `v1` has no handling. [#23105](https://github.com/anomalyco/opencode/issues/23105) reports the same stderr; [#44259](https://github.com/anomalyco/opencode/pull/44259) and [#44250](https://github.com/anomalyco/opencode/pull/44250) skipped every directory entry (dropping committed gitlinks too) and were closed unmerged.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `73eb3391dd` | `73e9e8b28e` | fast-forward `snapshot-unborn-nested`; pushed to `origin` and `nowaker-github` |
| `opencode` | `snapshot-unborn-upstream` | - | `d8087e0352` | new branch on `github/v1`, pushed to `origin` and `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Send the model request while file snapshots run](../features/2026-11-01-async-snapshots.md) | follow-up | removes the `does not have a commit checked out` failures that the [index.lock live check](./2026-11-10-snapshot-index-lock.md#live-check-2026-11-13) counted (926 of 940 `failed to add snapshot files` lines on desktop) |

## Other delivered work

- Primary checkout `bun install` (no lockfile or tracked-file change): the pre-push hook passes again from the primary checkout, 30/30 typecheck tasks, used for the `dev-nowaker` push.

## Verification

- `bun run test test/snapshot/snapshot.test.ts` in `packages/opencode` (worktree) - 70 pass, 1 skip, 0 fail; the new test "nested repository without a commit does not block the snapshot" fails on the old code (`patch.files` empty). `bun typecheck` clean.
- Upstream twin on `github/v1`: same test (asserting via `patch()`) fails without the source change, 56 pass / 1 skip / 0 fail with it, typecheck and Prettier clean.
- Live check in `~/projekty/tmp/vibeterm/opencode-omo-demos` (its nested `tmp/w4-proof-FFDPTt/project` still has no HEAD): a fresh desktop tab on vt-474, probe session [`ses_e28300500ffe42XZY7r2dnuLCr`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e28300500ffe42XZY7r2dnuLCr), listed, wrote and removed `tmp/snapshot-probe-e284.txt`. All 12 of its `snapshot op` lines are `ok=true` (the first track staged 2,392 files), 4 of 4 step-start and step-finish parts carry a snapshot hash, and 2 patch parts were recorded. The log shows `skipping nested repositories without a commit` for W4's repository and four `w2-delegation/.../home/project/` repositories. No `failed to add snapshot files` line was written for the probe, where 926 had appeared in the 2026-11-11/12 window.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh` on desktop, then m4max after `git pull --ff-only origin dev-nowaker` and `bun install --frozen-lockfile`.
- Installed artifact: `1.19.5-vt-474-006d837c50` on both hosts; desktop inode `49972503`, m4max inode `74219429`; v2 guard gate PASSED on both (desktop against cached `@opencode/cli@2.2.7` because the 2.3.0 download would have broken the 50 GB disk reserve; m4max against 2.3.0); the new log line and the retry marker are in both binaries; `.vibeterm/smoke.sh` SMOKE OK on both.
- Running services: not restarted.

## Commit provenance

- `73e9e8b28e` - fork fix and test; `d8087e0352` - upstream twin.
- Required trailer: `AI-Session-ID: ses_e284adde6ffe1ycvQIhjknnH3s`

The record cannot contain its own eventual commit hash. Resolve it with:

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-11-13-snapshot-unborn-nested.md
```

## Unknowns and blocked verification

- None.
