# Open a paste placeholder's text by clicking it

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `prompt-paste-undo` (fork); `paste-edit-dialog` (upstream PR head `0de7073e89`, stacked on undo, paste summary and #53871)
- First local commit: `460027c707`
- Current local commit(s): `460027c707`
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `dfb56f76c7` (upstream `v1`, contains `v1.19.0`)
- Upstream: PR [#54463](https://github.com/anomalyco/opencode/pull/54463) against `v1`; comment on [#8501](https://github.com/anomalyco/opencode/issues/8501#issuecomment-6105872904). **Needs a v2 port later.**

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 28), quoting the user:

> allow user to click on [ pasted content ] to open a modal that shows the entire text; editable, scrollable, etc. - use the same prompt editor code in that modal as exists on prompt fields, just make it show up in a modal, escape to close/save; button below to replace [ placeholder ] with inlining it

## Goals

- A click on a pasted-text placeholder opens `DialogPaste`: the text in a textarea with the prompt's input keybinds, mouse caret placement and grouped undo; enter adds a line.
- Closing saves; the label is rebuilt with `pasteLabel` when the text changed it. **Inline** replaces the placeholder with the text; empty text removes it. Both are one prompt undo step.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `460027c707` | 2026-10-10 | click-to-edit dialog | `packages/tui/src/component/dialog-paste.tsx`; `pasteAtCaret`, `openPaste`, `replacePaste`, `pasteClick` in `component/prompt/index.tsx`; `pasteLabel` in `prompt/paste.ts`; `test/component/prompt-paste.test.tsx`, `test/fixture/prompt-app.ts`; tui.mdx Clickable elements and "Paste summary" |

## Verification

- `prompt-paste.test.tsx` 4 pass (real app, mouse click on the placeholder).
- Real-PTY rig: SGR click on `[Pasted ~3 lines]` opened the dialog; `zero` + enter + esc gave `[Pasted ~4 lines]`; a click on **Inline** put four lines in the prompt; ctrl+z restored the placeholder.

## Timeline

- 2026-10-10 [`ses_ed7634c31ffeH84yR0S99Ty8Nd`](../sessions/2026-10-10-prompt-paste-undo.md) - introduced. Evidence: commit above.
- 2026-10-11 [`ses_ed5f9f826ffeno6fI51rL96d5Q`](../sessions/2026-10-11-upstream-v1-19.md) -
  rebased unchanged onto upstream `v1` `dfb56f76c7` (`v1.19.0`).
  Evidence: patch-identical in `git range-diff`; that session's gates.

