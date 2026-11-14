# 07 - Bound stored file-edit diffs

Status: READY TO FILE, NOT FILED - held by the explicit instruction to prepare the queue entry without opening an upstream PR. Before filing, confirm a free author PR slot and re-check `v1` against the prepared head.

- Repository/base: `anomalyco/opencode`, `v1` at `acc8c26da40f918e1ce222cb03c3342242c3ed6a`.
- Head: `Nowaker:stored-diff-upstream`, `abbf523742eb6846495265e9d1076ac831fab6bf`, one source commit above the base; published to `origin` and `nowaker-github`.
- Fork twin: `d1fa02fa49401fcc5eea013be221b47dc05dd653` on `dev-nowaker`. The write-output assertion differs only because the fork already reports bytes and upstream does not.
- Scope: the three file-editing tool producers, their direct regression tests and two existing renderer test files. No forklog or other fork customization in the proposed range.
- Queue owner: [`ses_e26ade36cffe6IX1G9BDtSy0us`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e26ade36cffe6IX1G9BDtSy0us).
- Delivery evidence: [session record](../sessions/2026-11-14-stored-diff-caps.md).

## Title

`fix(tools): bound stored file edit diffs`

## Upstream body

<!-- BEGIN PR BODY -->
### Issue for this PR

A file deletion can generate a huge unified diff even when the model's apply_patch input is tiny. One observed deletion stored a 392,459,917-byte tool part because the diff was retained both as the combined metadata diff and in the per-file patch array. Edit and write permission previews have the same unbounded path.

### Type of change

- [x] Bug fix
- [ ] New feature
- [ ] Refactor / code improvement
- [ ] Documentation

### What does this PR do?

Add one shared `capDiff` helper beside `trimDiff` and cap file previews at 256 KiB, including their truncation marker. The helper keeps complete UTF-8 lines and reports the exact number of bytes and lines not stored. It encodes only a bounded prefix instead of copying the complete diff into another buffer.

Use the helper for edit permission/interim/result metadata, write permission metadata, and apply_patch's per-file patches. Cap the combined apply_patch metadata diff separately at 1 MiB. Permission and result metadata share those bounded previews.

Keep additions and deletions based on the full content. Correct deleted-file line counts for empty and newline-terminated files. Leave model-facing output unchanged.

Existing TUI and web renderer fallbacks tolerate incomplete hunks without throwing. Regression tests exercise the TUI's raw patch fallback in unified and split views and the shared web normalizer's filename/count preservation. No renderer implementation change is needed.

### How did you verify your code works?

The nine large-file tool regression cases failed before the fix because the stored strings exceeded the byte bounds. They cover 20 MiB add, update, move and delete operations, edit creation and replacement, write creation and overwrite, and a multi-file aggregate preview.

Tests ran one file at a time without timeout increases. From `packages/opencode`, the cap helper, apply_patch, edit and write test files passed with 4, 33, 31 and 17 tests respectively. From `packages/session-ui`, `bun test src/components/session-diff.test.ts` passed 11 tests. From `packages/tui`, the inline-tool wrapping suite passed 19 tests and 8 snapshots. Total: 115 pass, 0 fail.

`bun typecheck` passed separately in opencode, TUI and session UI. Both source-branch push hooks also completed all 30 workspace typecheck tasks. The byte cap is covered with multi-byte UTF-8, exact-limit input, missing final newlines and a single oversized line.

### Screenshots / recordings

No visual styling changes. The TUI test renders the real diff component and verifies the retained patch and truncation marker remain visible.

### Checklist

- [x] I have tested my changes locally
- [x] I have not included unrelated changes in this PR

This PR is AI generated, but under direct supervision and on request of @Nowaker.
<!-- END PR BODY -->

## Filing command - prepared, do not execute without authorization

Use the existing private environment file; never copy its credential into this document or the command text.

```bash
(
  source /home/nowaker/projekty/nowaker/env
  GH_TOKEN="${GITHUB_TOKEN_CLASSIC_PUBLIC_REPO:?Classic public-repo token is required}" gh pr create \
    --repo anomalyco/opencode --base v1 --head Nowaker:stored-diff-upstream \
    --title 'fix(tools): bound stored file edit diffs' \
    --body-file <(awk '/^<!-- BEGIN PR BODY -->$/{body=1;next}/^<!-- END PR BODY -->$/{exit}body' /home/nowaker/projekty/webapps/opencode/.vibeterm/forklog/pr-queue/07-stored-diff-caps.md)
)
```
