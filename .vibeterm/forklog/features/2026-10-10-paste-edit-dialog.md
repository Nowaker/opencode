# Open a paste placeholder's text by clicking it

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `prompt-paste-undo`, `paste-dialog-keys` (fork); `paste-edit-dialog` (upstream PR head `04406f7356`, stacked on undo, paste summary and #53871)
- First local commit: `460027c707`
- Current local commit(s): `f14cf8f3c5`, `612c137f8a` (Inline on screen), `633dbaade6` + `234cdf7f62` (keys, wrapped height); `460027c707` before the v1 rebase
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `dfb56f76c7` (upstream `v1`, contains `v1.19.0`)
- Upstream: PR [#54463](https://github.com/anomalyco/opencode/pull/54463) against `v1`; comment on [#8501](https://github.com/anomalyco/opencode/issues/8501#issuecomment-6105872904). **Needs a v2 port later.**

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 28), quoting the user:

> allow user to click on [ pasted content ] to open a modal that shows the entire text; editable, scrollable, etc. - use the same prompt editor code in that modal as exists on prompt fields, just make it show up in a modal, escape to close/save; button below to replace [ placeholder ] with inlining it

## Goals

- A click on a pasted-text placeholder opens `DialogPaste`: the text in a textarea with the prompt's input keybinds, mouse caret placement and grouped undo. Enter saves and closes like esc; the `input_newline` keys add a line.
- Closing saves; the label is rebuilt with `pasteLabel` when the text changed it. **Inline**, above the editor, replaces the placeholder with the text (up from the editor's first row selects it, enter presses it, down goes back); empty text removes it. Both are one prompt undo step.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `460027c707` | 2026-10-10 | click-to-edit dialog | `packages/tui/src/component/dialog-paste.tsx`; `pasteAtCaret`, `openPaste`, `replacePaste`, `pasteClick` in `component/prompt/index.tsx`; `pasteLabel` in `prompt/paste.ts`; `test/component/prompt-paste.test.tsx`, `test/fixture/prompt-app.ts`; tui.mdx Clickable elements and "Paste summary" |
| `612c137f8a` (`578201bc79` before the v1 rebase) | 2026-10-10 | the editor's height leaves room for the dialog's quarter-screen top offset, so Inline stays on screen and a long paste scrolls | `editorHeight` in `dialog-paste.tsx` (mirrors `paddingTop={height / 4}` in `ui/dialog.tsx`); `test/component/prompt-paste.test.tsx` "keeps Inline on screen at %i rows"; `withPrompt` `height` option in `test/fixture/prompt-app.ts` |
| `633dbaade6`, `234cdf7f62` | 2026-10-11 | enter saves and closes, newline on `input_newline`; Inline above the editor, reached by up and pressed by enter; editor height from wrapped rows | `useBindings` overrides of `input.submit` / `input.move.up` and the `inlineFocused` layer (`dialog.paste.inline`, `dialog.paste.editor`) in `dialog-paste.tsx`; `measure()` via `editorView.getTotalVirtualLineCount()`; `prompt-paste.test.tsx` enter/ctrl+j/up-Inline/wrapped-height tests; tui.mdx "Paste summary" |

## Verification

- `prompt-paste.test.tsx` 7 pass (real app, mouse click on the placeholder); the 50-line paste at 60 rows fails without `612c137f8a`.
- Real-PTY rig: SGR click on `[Pasted ~3 lines]` opened the dialog; `zero` + enter + esc gave `[Pasted ~4 lines]`; a click on **Inline** put four lines in the prompt; ctrl+z restored the placeholder.
- Real-PTY rig after `612c137f8a`: a 50-line paste clicked from row 13 of 24 put Inline on row 22; clicked from row 31 of 60, on row 58; clicking it inlined all 50 lines.

## Timeline

- 2026-10-10 [`ses_ed7634c31ffeH84yR0S99Ty8Nd`](../sessions/2026-10-10-prompt-paste-undo.md) - introduced. Evidence: commit above.
- 2026-10-11 [`ses_ed5f9f826ffeno6fI51rL96d5Q`](../sessions/2026-10-11-upstream-v1-19.md) -
  rebased unchanged onto upstream `v1` `dfb56f76c7` (`v1.19.0`).
  Evidence: patch-identical in `git range-diff`; that session's gates.
- 2026-10-10 [`ses_ed7634c31ffeH84yR0S99Ty8Nd`](../sessions/2026-10-10-prompt-paste-undo.md) -
  Inline was below the screen in a tall terminal (user report on vt-206);
  fixed in `612c137f8a`, installed as vt-211 (desktop) and vt-212 (m4max).
  Evidence: session "Follow-up: Inline button off screen".
- 2026-10-11 [`ses_ed7634c31ffeH84yR0S99Ty8Nd`](../sessions/2026-10-11-paste-dialog-keys.md) -
  enter saves and closes, Inline reachable by keyboard above the editor, editor height
  from wrapped rows (user report on vt-211); `633dbaade6`, `234cdf7f62`, installed as
  vt-223 on desktop and m4max. Evidence: that session's tests and real-PTY rig.
