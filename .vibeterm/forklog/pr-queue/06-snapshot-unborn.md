# 06 - Skip nested repositories without a commit in snapshots

Status: FILED 2026-11-14T06:03:52Z as [anomalyco/opencode#63897](https://github.com/anomalyco/opencode/pull/63897), base `v1`, head `d8087e0352fdd3ba72ff54f390e1a0bc24f18e35`, after #54578 closed unmerged and freed its slot. Open with 3/3 checks green on 2026-11-17; slot and nudge history live in [`00-open-slots.md`](00-open-slots.md). The filing command below was used and must not be run again.

- Repository and base: `anomalyco/opencode`, `v1` at `acc8c26da40f918e1ce222cb03c3342242c3ed6a`.
- Head: `Nowaker:snapshot-unborn-upstream`, `d8087e0352fdd3ba72ff54f390e1a0bc24f18e35`; one commit above `v1`. `git ls-remote` showed this head on both `origin` and `nowaker-github` on 2026-11-14.
- Fork twin: `73e9e8b28e` on `dev-nowaker`. The `add()` bodies differ (the fork returns staged byte counts), so the upstream commit is a hand port of the same change, not a cherry-pick. The upstream test asserts the gitlink through `patch()` because `v1` has no snapshot-store test helpers.
- Issue: [#23105](https://github.com/anomalyco/opencode/issues/23105) (closed) reports the exact stderr, `'<dir>/' does not have a commit checked out ... fatal: adding files failed`. Earlier fixes [#44259](https://github.com/anomalyco/opencode/pull/44259) (`dev`, legacy snapshot) and [#44250](https://github.com/anomalyco/opencode/pull/44250) (`v2`, core) skipped every directory-shaped entry and were closed unmerged. Related open work on the v2 line: [#62785](https://github.com/anomalyco/opencode/pull/62785) (status failure inside an embedded repository) and issue [#61383](https://github.com/anomalyco/opencode/issues/61383); neither touches the `v1` legacy snapshot. States verified through the public REST API on 2026-11-14.
- Scope: `packages/opencode/src/snapshot/index.ts` and its test; no forklog, configuration or unrelated fork customizations in the range.
- Documentation: no new setting or command.
- Queue owner: [`ses_e284adde6ffe1ycvQIhjknnH3s`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e284adde6ffe1ycvQIhjknnH3s).

## Title

`fix(snapshot): skip nested repositories without a commit`

## Upstream body

<!-- BEGIN PR BODY -->
### Issue for this PR

Fixes the snapshot failure reported in #23105.

### Type of change

- [x] Bug fix
- [ ] New feature
- [ ] Refactor / code improvement
- [ ] Documentation

### What does this PR do?

The snapshot store records an untracked nested repository as a gitlink to its HEAD. When that repository's branch has no commit yet, `git add` cannot record the gitlink and fails the whole batch:

```
error: 'tui/' does not have a commit checked out
error: unable to index file 'tui/'
fatal: adding files failed
```

Every later snapshot in that project fails the same way, so the session gets no diffs, patches or reverts until the nested repository gets a commit.

`add()` now checks each candidate directory that holds a `.git` entry with `git --git-dir <dir>/.git rev-parse --verify --quiet HEAD` and leaves out only the ones without a HEAD. Nested repositories with a commit are still recorded as gitlinks, and ordinary directories are untouched. The explicit `--git-dir` keeps git from climbing into the parent repository and skips the `safe.directory` ownership check.

#44259 and #44250 skipped every directory entry instead, which also drops the gitlinks of nested repositories that do have commits.

### How did you verify your code works?

From `packages/opencode`:

- `bun run test test/snapshot/snapshot.test.ts` - 56 pass, 1 skip, 0 fail. The new test "nested repository without a commit does not block the snapshot" creates a nested repository with no commit, then a nested repository with a commit and a modified tracked file. It asserts that the patch lists the modified file and the committed repository's gitlink and nothing under the empty one. Without the source change the patch is empty and the test fails.
- `bun typecheck` - passed. Prettier is clean on both files.

### Screenshots / recordings

Not a UI change.

### Checklist

- [x] I have tested my changes locally
- [x] I have not included unrelated changes in this PR

This PR is AI generated, but under direct supervision and on request of @Nowaker.
<!-- END PR BODY -->

## Filing command - prepared, do not execute while blocked

Requires Bash and `gh` on the filing host. The credential comes from the existing private env file and is never written into this artifact.

```bash
(
  source /home/nowaker/projekty/nowaker/env
  GH_TOKEN="${GITHUB_TOKEN_CLASSIC_PUBLIC_REPO:?Classic public-repo token is required}" gh pr create \
    --repo anomalyco/opencode --base v1 --head Nowaker:snapshot-unborn-upstream \
    --title 'fix(snapshot): skip nested repositories without a commit' \
    --body-file <(awk '/^<!-- BEGIN PR BODY -->$/{body=1;next}/^<!-- END PR BODY -->$/{exit}body' /home/nowaker/projekty/webapps/opencode/.vibeterm/forklog/pr-queue/06-snapshot-unborn.md)
)
```

Before filing, re-check that `v1` has not moved under the head (`git merge-tree --write-tree github/v1 snapshot-unborn-upstream`) and that a slot is free.
