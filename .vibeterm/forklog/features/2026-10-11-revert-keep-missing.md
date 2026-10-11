# Never delete a file whose earlier content the snapshot store lost

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `revert-keep-missing` (upstream, off `github/v1`); `keep-missing-land`
- First local commit: `69ec5e063c`
- Current local commit(s): `69ec5e063c`
- Upstream base when introduced: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Last checked against upstream: `dfb56f76c7`
- Upstream: issue [#54577](https://github.com/anomalyco/opencode/issues/54577) (critical, data loss),
  PR [#54578](https://github.com/anomalyco/opencode/pull/54578) against `v1` (`revert-keep-missing`, `98d128cad0`).
  Drop the local commit once #54578 lands in `v1`.

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` after item 29 noted
the finding; the user chose "Fix the delete case" and wrote:

> check if bug report exists. note it as critical issue, that needs a fix in
> v1 since it causes data loss.

## Goals

- A file revert deletes a file only when the snapshot positively records it
  as absent.
- A file whose earlier content the store no longer has is left as it is and
  named in a notice.

## Non-goals

- No change to snapshot pruning (`cleanup()`, `git gc --prune=7.days`).
- No change to `restore()` (Redo).

## Rationale and constraints

- `Snapshot.revert` ran `git ls-tree <hash> -- <file>` after a failed
  checkout and deleted the file unless ls-tree printed an entry. A missing
  tree makes ls-tree exit 128 (`not a tree object`) or 1 (missing subtree),
  which fell through to `remove()` ("file did not exist in snapshot,
  deleting").
- Snapshot trees have no refs; `cleanup()` prunes them after seven days.
  Only content also in the project repository survives through alternates,
  so any snapshot taken with uncommitted changes in the worktree is lost a
  week later, and reverting its turn deleted every file it touched.
- Existing reports found: #46783 (open, `/undo` deletes a file just read),
  #3148 (closed, file deleted on undo), umbrella #51360; PR #47861 (closed
  unmerged, against `dev`) capped deletions but kept the same test.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `69ec5e063c` | 2026-10-11 | Delete only on a successful empty ls-tree; keep and return the rest; `session.error` notice naming kept files | `single` in `revert` in `packages/opencode/src/snapshot/index.ts`; `Snapshot.Interface.revert` returning `string[]`; `reportKept` in `packages/opencode/src/session/revert.ts` |

## Verification

Session [`ses_ed759a0b4ffeCubC9xxc8hYgHY`](../sessions/2026-10-11-revert-keep-missing.md):

- `bun test test/snapshot/snapshot.test.ts test/session/revert-compact.test.ts`
  (packages/opencode, fork) - 69 pass. The two new tests garbage-collect the
  store with `git gc --prune=now` and fail without the fix (files deleted).
- Upstream branch: 95 pass across `test/snapshot`, `revert-compact`,
  `session`, `httpapi-session`.
- Real PTY (throwaway tmux socket, fake provider writing `notes.txt`, an
  untracked file in the worktree): store pruned, own edit appended, Revert
  kept the file with the edit and showed "Revert kept 1 file as is because
  the snapshot store no longer has the earlier version: notes.txt".

## Timeline

- 2026-10-11 [`ses_ed759a0b4ffeCubC9xxc8hYgHY`](../sessions/2026-10-11-revert-keep-missing.md) -
  initial fix, issue #54577, PR #54578, installed on desktop and m4max.
  Evidence: `69ec5e063c`.

## Current maintenance notes

- On an upstream bump, check whether `v1` contains #54578; if so this commit
  is superseded.
- The fork's `revert-compact.test.ts` carries both item 29's messages-only
  tests and this test; keep `EventV2Bridge.node` in its layer group.

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- Classify the customization as preserved, conflicted, superseded, or removed.
- Reverse any deliberate uncommitted patch before merging, then reapply its
  canonical patch afterward.
- Regenerate derived clients or schemas instead of editing generated files.
- Run the feature's focused tests and affected package typechecks.
- Build through the host's canonical installer and verify the installed binary.
- Confirm protected services kept the same PID and start timestamp.
- Link a new timeline row to the current session record.
- Update `Last checked against upstream`.
