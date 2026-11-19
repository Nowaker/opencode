# Shift+arrow in the prompt selects only the crossed cells

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `selection-boundary-fork` (fork port), `selection-boundary-v1` (upstream `v1` branch, not merged into the fork)
- First local commit: `b08907771b`
- Current local commit(s): `b08907771b`
- Upstream base when introduced: `006d837c50` (merge-base with `github/v1`)
- Last checked against upstream: upstream `v1` `c618499abc` (tag `v1.19.6` has the same tree), 2026-11-19

## Original request

> W17 v2 (3c9bf898) is GREEN on desktop [...] 1. Commit the 3 files on selection-boundary-v1 [...] Push it to BOTH remotes as a branch only. Do not merge it anywhere. 2. Write the W18 pr-queue entry [...] 3. Freeze the dev-nowaker port as its own packet afterwards (it runs on the fork's patched 0.4.5, so its own red/green [...]).

(v2 coordinator [`ses_e383ee7faffe6JX8m2EP26dXUC`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e383ee7faffe6JX8m2EP26dXUC), 2026-11-19T04:18Z. The original shift+left report that started W17 is TBD - not present in this session's retained history.)

## Goals

- One shift+left from inside the prompt text selects exactly the cell the caret crossed; word, line, buffer and vertical selection moves select exactly the crossed interval.
- Text selected in the instant startup prompt before the TUI loads reaches the real prompt with the same boundaries.

## Non-goals

- Mouse selection is unchanged.
- No OpenTUI upgrade: the boundary-occupancy fix arrives in OpenTUI 0.5.7, which v1 cannot take.

## Rationale and constraints

- OpenTUI 0.4.5's keyboard selection brackets each cursor move with the renderer's cell-inclusive mouse selection (`updateSelectionForMovement`), so every keyboard selection was one cell too wide and its anchor sat one cell past the caret. The fork's `patches/@opentui%2Fcore@0.4.5.patch` touches `CliRenderer` and `ExtmarksController` only, never selection.
- The prompt renders `PromptTextareaRenderable` (`<prompt_textarea>`), a `TextareaRenderable` subclass that keeps native movement and renderer ownership (copy, dismiss) and turns each keyboard selection into an exclusive range from the anchor caret to the current caret. It relies on protected members of 0.4.5. It is exported only so the test can assert the prompt uses it.
- The fork's instant startup editor (`src/instant/editor.ts`, from `4ba5808d09`) deliberately copied 0.4.5's rule ("a backward selection reaches one cell further than the anchor") and its parity test held it to a stock textarea. A prompt-only port would hand a one-cell-too-wide selection to the fixed prompt through `instant/caret.ts` `place()`, so its `selection()` is now the plain anchor-caret range and the parity test drives the subclass.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `b08907771b` | 2026-11-18 | prompt renders the boundary-selection subclass; instant editor selection is the plain anchor-caret range | `packages/tui/src/component/prompt/textarea.ts` `PromptTextareaRenderable`; the `<prompt_textarea` tag in `component/prompt/index.tsx`; `InstantEditor.create` `selection`; `test/instant/parity.ts` |

## Verification

From fork packet `w17/fork-packet.json` (`74f08bd7`), run by W15 on desktop, finished 2026-11-19T04:44Z, read by the coordinator:

- Mutant (empty subclass): `test/cli/tui/prompt-selection.test.tsx` red 0/1 at "first ShiftLeft selects only the crossed cell".
- Mutant (the old instant `editor.ts`): `test/instant/editor.test.ts` "every editing action from every caret position" red on its mismatch list.
- Green: the keeper 1/0 (its stock-textarea control still shows {15,17} "67" under the patched 0.4.5; the prompt selects {15,16} "6"), `test/instant/` 41/0, tui prompt/component/cli/session-route suites 423/0, opencode `test/cli/tui` 70/0, `bun turbo typecheck` 30/30.
- Installed on desktop as `opencode` `1.19.5-vt-556-006d837c50` through `.vibeterm/build.sh` with the retry-cap and v1 guard gates (build packet `w17-build/packet.json` `2801fd45`, verified by the coordinator 2026-11-19T05:00Z).
- Not proven: full-app focus routing, the live instant-to-prompt handoff, wide Unicode, tabs, wrapping, resize, mouse dragging, clipboard delivery. No live TUI was driven.

## Timeline

- 2026-11-18 [`ses_e3832b1b0ffe6q98OeUzhgqhjQ`](../sessions/2026-11-18-prompt-keyboard-selection.md) - initial build, upstream `v1` branch, fork port and desktop install. Evidence: linked session record.

## Current maintenance notes

- On an upstream bump, check that the prompt still renders a `TextareaRenderable` and that 0.4.5's protected `updateSelectionForMovement`, `onSelectionChanged`, `lastLocalSelection` and `editorView` still exist; drop the subclass once the fork reaches OpenTUI 0.5.7 or later.
- Upstreamable as the `v1` branch `selection-boundary-v1` (`7c9c67ee2a`); see [pr-queue entry 14](../pr-queue/14-prompt-keyboard-selection.md). The instant-editor half is fork-only.
- m4max install deferred while it travels.
