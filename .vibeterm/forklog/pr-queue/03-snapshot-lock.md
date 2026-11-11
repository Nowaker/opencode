# 03 - Wait for the snapshot index lock

Status: CORRECTED HEAD VERIFIED AND PUSHED; FILING BLOCKED - [#60452](https://github.com/anomalyco/opencode/pull/60452) is already open against `v1` for the same snapshot contention and stdin-closure problem. The main coordinator must reconcile that overlap before proposing another PR. All three author PR slots are occupied. Opening a PR or issue requires separate authorization.

- Repository and base: `anomalyco/opencode`, `v1` at `006d837c5022ea5278162307c04c78412cfae9f3`.
- Head: `Nowaker:snapshot-lock-upstream`, `c2b9c9553c876ebbb3913cef3cf449a577b81864`.
- Source commits: `ec838f8fcf0224ae80022d026fc7128d681d4a43` and `10c014b816fc3495966f62a48770d06befaa3694`; review corrections `7f263961b86d5ca73d7ec3e1d2ab07d404391f4e` and `c2b9c9553c876ebbb3913cef3cf449a577b81864`.
- Cut point and merge base: `006d837c5022ea5278162307c04c78412cfae9f3`; four commits above upstream `v1`. Existing history was preserved with new commits.
- Current upstream preflight: `v1` advanced to `acc8c26da40f918e1ce222cb03c3342242c3ed6a` during preparation. The two intervening commits change CI and image-history/provider-error handling, not the snapshot or stdin files. `git merge-tree --write-tree` succeeds (combined tree `25e500fac81530c330daf553a42e7ee8778491dd`). The focused QA below binds the original cut and exact head, not a separately tested latest-base merge.
- Live-ref check: `2026-11-11T12:12:12Z`, using `git ls-remote`; path-set intersection between upstream changes since the cut and this head is empty (0 paths). The unchanged head follows the main coordinator's approved no-overlap procedure.
- Remote evidence: ordinary pushes preserved the existing history; `git ls-remote` independently verified `c2b9c9553c876ebbb3913cef3cf449a577b81864` on both `origin` and `nowaker-github` on November 11, 2026. Normal push hooks passed 30/30 typecheck tasks.
- Issue and competing implementation: [#60447](https://github.com/anomalyco/opencode/issues/60447) describes the same lock contention, stale captures and stdin EPIPE; it is closed with `state_reason: not_planned`. The related open PR [#60452](https://github.com/anomalyco/opencode/pull/60452), head `tool-snapshot` at `6a9f25e93d7618d09fa5c233a89154b25165d104`, targets `v1` at `006d837c50`. Both states and the PR head/base were verified through the public REST API. No upstream equivalence or merge is claimed.
- Scope: snapshot lock contention and the child-stdin EPIPE crash exposed by it. Five source/test files; no forklog, configuration or unrelated fork customizations in the upstream range.
- Documentation: no new public setting or command. The PR body explains the retry behavior and unchanged failure outcome; the branch has no user-doc file changes.
- Queue owner: [ses_e35d3b407ffeoWf7J2yaxy1Vzp](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e35d3b407ffeoWf7J2yaxy1Vzp).
- Review: [ses_e35c330d1ffeu1TwHBsyKfag6S](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e35c330d1ffeu1TwHBsyKfag6S) closed both required findings at the exact corrected head: active stdin errors reach NodeSink, and returned snapshot trees are checked before any restaging. The old scratch draft is superseded by this canonical queue body.

## Title

`fix(snapshot): wait for an index.lock another process holds`

## Upstream body

<!-- BEGIN PR BODY -->
### Issue for this PR

Fixes #60447. Related open PR: #60452. This candidate is held until the overlap with that PR is reconciled; the closed issue is not evidence that the fix has merged.

### Type of change

- [x] Bug fix
- [ ] New feature
- [ ] Refactor / code improvement
- [ ] Documentation

### What does this PR do?

Two opencode processes in the same folder share a snapshot store, but its semaphore only protects one process. A concurrent git operation can therefore fail on the other process's `index.lock` and miss the snapshot.

Retry only that held-lock error, up to eight retries with jittered exponential delays from 25 ms to an 800 ms cap. The total wait is about 1.6-3.2 seconds. The lock is never deleted, and exhausted retries return the original failure result.

The regression also exposed an uncaught EPIPE when a child exits before consuming stdin. The spawner ignores late stdin EPIPE. Active errors retain NodeSink's existing `PlatformError` mapping; otherwise unhandled non-EPIPE errors still throw, and the child's exit code remains available.

### How did you verify your code works?

On this exact head, from the package directories in isolated HOME, XDG, temporary and tool-data roots:

- `packages/opencode`: `bun run test test/snapshot/snapshot.test.ts` - 57 pass, 1 skip, 0 fail. The regressions hold a lock until release and run two independent snapshot services concurrently, inspecting returned trees directly. A deliberate stale-tree mutation makes both regressions fail.
- `packages/core`: `bun test test/effect/cross-spawn-spawner.test.ts test/effect/cross-spawn-stdin.test.ts` - 28 pass, 0 fail. Active EIO reproduces the uncaught error on the old candidate; the corrected implementation preserves typed error handling. Coverage also checks active EPIPE and both late-error cases.
- `bun typecheck` in both packages - passed.

### Screenshots / recordings

Not a UI change.

### Checklist

- [x] I have tested my changes locally
- [x] I have not included unrelated changes in this PR

This PR is AI generated, but under direct supervision and on request of @Nowaker.
<!-- END PR BODY -->

## Filing command - prepared, do not execute while blocked

Requires Bash and `gh` on the filing host. The credential comes from the existing private env file and is never written into this artifact. Extracting the body uses this same canonical file; it requires no new prose.

```bash
(
  source /home/nowaker/projekty/nowaker/env
  GH_TOKEN="${GITHUB_TOKEN_CLASSIC_PUBLIC_REPO:?Classic public-repo token is required}" gh pr create \
    --repo anomalyco/opencode --base v1 --head Nowaker:snapshot-lock-upstream \
    --title 'fix(snapshot): wait for an index.lock another process holds' \
    --body-file <(awk '/^<!-- BEGIN PR BODY -->$/{body=1;next}/^<!-- END PR BODY -->$/{exit}body' /home/nowaker/projekty/webapps/opencode/.vibeterm/forklog/pr-queue/03-snapshot-lock.md)
)
```

The main coordinator must reconcile the competing PR, approve filing and confirm a free slot before this command is used. The current known open author PRs are [#54578](https://github.com/anomalyco/opencode/pull/54578), [#63062](https://github.com/anomalyco/opencode/pull/63062), and [#63063](https://github.com/anomalyco/opencode/pull/63063).
