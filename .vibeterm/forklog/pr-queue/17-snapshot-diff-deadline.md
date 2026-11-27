# 17 - Bound snapshot diff work that holds the store lock (v1)

Status: PREPARED, NOT FILED. The three-slot cap is full (see [00-open-slots](00-open-slots.md)). This entry follows 16.

- Target: `anomalyco/opencode:v1`, upstream base `c618499abc` (`v1.19.6`). Head: `Nowaker:snapshot-diff-deadline`, [`7b6c5da05f`](https://github.com/Nowaker/opencode/commit/7b6c5da05f).
- Fork counterpart: [`ee5d3e7f44`](https://gitlab.com/vibeterm/opencode/-/commit/ee5d3e7f44). The fork's tool preflight and snapshot log changes are not part of the upstream candidate.
- Evidence: [fork session record](../sessions/2026-11-27-snapshot-preflight.md).

## Title

`fix(snapshot): bound diff work that holds the store lock`

## Upstream body

<!-- BEGIN PR BODY -->
### What does this change?

While computing a snapshot diff, a stalled `git cat-file --batch` process or per-file `git show` fallback can hold the store lock and block all later operations on the same worktree. Share one 30-second deadline across the work done under that lock, and reap the scoped child before allowing another operation through. A missing display diff does not replace an existing summary or prevent recording file changes that a revert already applied.

Also refuse to publish a tree hash as the new baseline when staging failed. In that case the hash can name the preceding index rather than the current worktree.

### How was it verified?

- Focused fixtures hold either the batch process or the fallback and queue a real `track()`. Both failed to acquire the store on unmodified `v1`; the third regression confirmed a stale hash after a genuine Git staging failure. All three pass after the fix.
- On macOS, `bun run test test/snapshot/snapshot-failure.test.ts test/snapshot/snapshot.test.ts test/session/revert-compact.test.ts`: 66 passed, 1 skipped, 0 failed. `bun run typecheck` in `packages/opencode` exited 0.

This PR is AI generated, but under direct supervision and on request of @Nowaker.
<!-- END PR BODY -->

Before filing: recheck upstream v1 and the available slot, then verify the branch against the current base.
