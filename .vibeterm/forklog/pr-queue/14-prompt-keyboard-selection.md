# 14 - Shift+arrow in the prompt selects only the crossed cells (v1)

Status: READY TO FILE, NOT FILED. Damian approved queuing it on [2026-11-26 CST](https://portal.vibeterm.desktop.ts.nowaker.net/question/qst_1f2061dd90014fpE7b6897eTcc). The daily PR drain files it after entries 10, 11, 12 and 13 when one of the [three author slots](00-open-slots.md) frees. Recheck upstream `v1` and rerun the regression if the base has moved.

- Target: `anomalyco/opencode:v1`. Branch [`Nowaker:selection-boundary-v1`](https://github.com/Nowaker/opencode/tree/selection-boundary-v1), [`7c9c67ee2a`](https://github.com/Nowaker/opencode/commit/7c9c67ee2a39ff3bdd4fc13bc83426c0a03b0ab6), on both fork mirrors, one commit, 3 files +187/-1. Not merged anywhere.
- Base: v1.19.6 (tree of `c618499abc`). Upstream `v1` was `c618499abc` and tag `v1.19.6` (`f4e363c829`) has the same tree `53420ce9`, checked with `git ls-remote github` 2026-11-19 around 04:20Z, so no rebase is needed as of that check.
- Upstream issue: none found. Public search API 2026-11-19 for shift+left / keyboard / prompt selection found related but different issues only, e.g. [#61992](https://github.com/anomalyco/opencode/issues/61992) (copying a keyboard selection).
- Defect: upstream v1 pins `@opentui/core` 0.4.5 without a patch. Its keyboard selection reuses the renderer's cell-inclusive mouse selection, so one shift+left from inside the text selects two cells. OpenTUI's own fix arrives in 0.5.7, which v1 cannot take.
- Fork port: the same substitution fits `dev-nowaker`'s prompt with its patched 0.4.5; that combination is untested and runs as its own packet.
- Owner: [`ses_e3832b1b0ffe6q98OeUzhgqhjQ`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3832b1b0ffe6q98OeUzhgqhjQ), under the [v2 coordinator `ses_e383ee7faffe6JX8m2EP26dXUC`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e383ee7faffe6JX8m2EP26dXUC).

## Title

`fix(tui): select only the crossed cells with shift+arrow in the prompt`

## Upstream body

<!-- BEGIN PR BODY -->
### Issue for this PR

None filed. Found while editing prompts with the keyboard.

### Type of change

- [x] Bug fix
- [ ] New feature
- [ ] Refactor / code improvement
- [ ] Documentation

### What does this PR do?

In the prompt, pressing shift+left with the caret inside the text selects two characters: the one the caret crossed and the one under the caret. Every keyboard selection is one cell too wide, and its anchor sits one cell past the caret. OpenTUI 0.4.5 builds keyboard selection from the renderer's mouse selection, which includes both the start and the end cell.

The prompt now renders a small `TextareaRenderable` subclass. It keeps the native cursor movement and the renderer's selection ownership, so copying and dismissing a selection work as before, but makes each keyboard selection an exclusive range from the caret where the selection started (or the far end of an existing selection) to the current caret. A selection that collapses back to its anchor clears, and right arrow collapses a keyboard selection to its end instead of one cell before it. Mouse selection is unchanged.

The subclass relies on protected members of OpenTUI 0.4.5. It is exported only so the test can check that the prompt uses it.

### How did you verify your code works?

New `packages/tui/test/cli/tui/prompt-selection.test.tsx` mounts the subclass and a stock textarea side by side under the opencode keymap and sends real key sequences:

- The stock textarea reproduces the bug: one shift+left selects cells {15,17}, the text "67".
- The prompt's textarea selects {15,16}, "6", and exactly the crossed cells for word, line, buffer and vertical selection moves (1 pass, 0 fail).
- With the subclass emptied, the test fails at "first ShiftLeft selects only the crossed cell".

The existing `packages/tui` lifecycle, prompt and dialog-prompt suites pass (22 pass, 0 fail), `packages/opencode` `test/cli/tui` passes (67 pass, 0 fail), `bun run typecheck` in `packages/tui` passes, and workspace `bun turbo typecheck` passes (30/30).

Not covered: focus routing in the full app, wide Unicode characters, tabs, wrapping, resizing, mouse dragging and the clipboard.

### Checklist

- [x] I have tested my changes locally
- [x] I have not included unrelated changes in this PR

This PR is AI generated, but under direct supervision and on request of @Nowaker.
<!-- END PR BODY -->

## Evidence

- Packet `w17/packet.json` (`3c9bf898`), run by W15 on desktop, result `w15-w17-2.result.json`: `rows-settled`, exit 0, finished 2026-11-19T04:16Z; final source sha256 `1b3021ac` (`index.tsx`), `a7dcd886` (`textarea.ts`), `849251df` (test), the bytes committed in `7c9c67ee2a`. Read by the coordinator 2026-11-19T04:18Z.
- Rows: frozen install exit 0; source check 1 (`<prompt_textarea` in `index.tsx`); `packages/tui` typecheck exit 0; mutant (empty subclass, `c6d466df`) red at "first ShiftLeft selects only the crossed cell", no timeout; the test 1/0; tui suites 22/0; opencode `test/cli/tui` 67/0; `bun turbo typecheck` 30/30.
- Dropped: a full-app test focused a dialog input instead of the prompt, and once rendered a blank frame (35 empty rows, no error logged) when the fixture had a connected provider. Not pursued; the direct-mount test replaced it.

## Before filing

Re-check upstream `v1`; if it moved, rebase and rerun the test and the suites there. Decide whether the upstream commit keeps its AI trailers: the forklog README says upstream commits stay free of them, while the last filed head (#63897, `d8087e0352`) kept them. Check that a slot is free.
