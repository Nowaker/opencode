# A paste dialog with cleanup and wrap options on every paste

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `paste-modal-mode` (fork); `paste-dialog-mode` (upstream PR head `5753e93597`, stacked on `paste-edit-dialog`)
- First local commit: `070fe4290b`
- Current local commit(s): `070fe4290b`, `4d3f094277` (toggles undo themselves, right arrow), `85a5c7edb2` (remove indents, join into one line)
- Upstream base when introduced: `dfb56f76c7` (upstream `v1`, contains `v1.19.0`)
- Last checked against upstream: `dfb56f76c7` (upstream `v1`, contains `v1.19.0`)
- Upstream: PR [#56268](https://github.com/anomalyco/opencode/pull/56268) against `v1`, stacked on #54463. **Needs a v2 port later.**

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, quoting the user:

> just copy to clipboard, and then, a special paste shortcut that allows - on any pastie, not just selected from oc - to tick checkboxes what to do with it, instead of landing it in the prompt first. ...this could actually be even betteer than thecurrent ^V and click on pasted summary for actions.
>
> ok so here's the spec, new mode for ^V behavior; old is what we have in oc-vt now. new one:
> - ^V always opens a modal like our new modal.
> - on the left, a list of checkboxes options:   - they remember previous paste action selection
>   - [ ] insert inline      - if unselected, shows [ pasted content ] thing, still clickable later
>   - [ ] wrap with ```
>   - [ ] wrap with `        - inactive (grayed out? not even present?) for multiline content
>   - [ ] quote with <
>   - [ ] trim whitespace    - trims whitespace in each line; removes excess \n from the beginning and end of the doc
>   - [ ] normalize indents  -  eg if code is pasted and is indented at level 4 and above, nornalize to 0 and above
>   - [ ] ...anything else?
>   - space toggles, enter submits (pastes into prompt)
>   - ^Z after paste removes pasted content and reopens this modal (content is taken from history, not from clipboard any more, it may be gone from there!)
>   - click into [ pasted content ] brings it up.
> - on the right: the field
>   - immediately reacts to any modifications picked on the left
>   - remains editable like previously
>
> and enable for us.

## Goals

- `prompt.paste_mode`: `"direct"` (default, unchanged) or `"dialog"`, where every text paste (ctrl+v or the terminal's paste) opens `DialogPasteOptions` first.
- Options on the left, remembered in kv.json `paste_options`; the result on the right in the prompt's editor and `PromptFrame`, live and editable.
- Space toggles, enter pastes, esc cancels, tab/shift+tab switch options and editor.
- Undo right after a dialog paste takes it back and reopens the dialog from history; a placeholder click reopens it with the same options.

## Non-goals

- The raw paste key (`input_paste_raw`), images and pasted file paths are unchanged.
- Keeping a drag selection highlighted after mouse release (asked about, then dropped by the user).

## Rationale and constraints

- "quote with <" in the request is implemented as Markdown's `>`.
- "wrap with `" is shown greyed out (not hidden) for multi-line text, so the list keeps its shape.
- "trim whitespace" trims trailing whitespace only; leading whitespace is indentation, owned by "normalize indents".
- "normalize indents" compares the common indent character by character, so tabs and spaces never count as each other.
- Added: "collapse blank lines" and "strip ANSI escapes" (copied terminal output).
- Insert inline off means a placeholder however short the paste is, as the request says.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `070fe4290b` | 2026-10-16 | `prompt.paste_mode` and the paste dialog | `PasteOptionList`, `applyPasteOptions`, `cleanPaste`, `wrapPaste`, `unwrapPaste`, `PasteOptionsKVKey` in `packages/tui/src/prompt/paste-options.ts`; `DialogPasteOptions` in `component/dialog-paste-options.tsx`; `openPasteDialog`, `placePaste`, `pasteOrigins`, `lastPaste`, the `input.undo` command and the `paste_mode` branches of `pasteInputText` and `openPaste` in `component/prompt/index.tsx`; `split()` in `prompt/undo.ts`; `Prompt.paste_mode` in `config/index.tsx`; `test/prompt/paste-options.test.ts`, `test/component/prompt-paste-dialog.test.tsx`; tui.mdx "Paste dialog" |
| `4d3f094277` | 2026-10-16 | options undo themselves until a real edit (OpenTUI reports textarea changes a microtask late); right from the options into the editor, tab back | `adoptEdit` comparing `textarea.plainText` with `text()` and the `right` binding in `dialog-paste-options.tsx`; reversibility and focus tests in `prompt-paste-dialog.test.tsx` |
| `85a5c7edb2` | 2026-10-18 | remove indents and join into one line; normalize indents greyed under remove indents, collapse blank lines greyed under join; options list scrolls | `unindent`, `join`, `joinLines`, `pasteOptionDisabled(key, body, options)` in `prompt/paste-options.ts`; the options `scrollbox` and `listHeight` in `dialog-paste-options.tsx`; seeded random walks in `test/prompt/paste-options.test.ts` |

## Verification

- `test/prompt/paste-options.test.ts` 14 pass; `test/component/prompt-paste-dialog.test.tsx` 8 pass; full `packages/tui` 758 pass, 0 fail; PR branch 275 pass, 0 fail.
- Real PTY, installed vt-322, private Xvfb clipboard: see the session record.

## Timeline

- 2026-10-16 [`ses_ed7634c31ffeH84yR0S99Ty8Nd`](../sessions/2026-10-16-paste-dialog-mode.md) - introduced; installed vt-322 on desktop and m4max; enabled for the user through Vibeterm settings. Evidence: commit above, that session's verification.

## Current maintenance notes

- Vibeterm enforces `opencodeTui.prompt.paste_mode` = `dialog` (opencode-tools `33022c63` decides the knob global-only and regenerates the catalog).
- 2026-10-16 [`ses_ed7634c31ffeH84yR0S99Ty8Nd`](../sessions/2026-10-16-paste-dialog-mode.md) -
  unticking an option did not restore its change (user report on vt-322+); fixed in
  `4d3f094277` with right arrow into the editor, installed as vt-333 on desktop and m4max.
  Evidence: that session's "toggles undo themselves" section.
- 2026-10-18 [`ses_ed7634c31ffeH84yR0S99Ty8Nd`](../sessions/2026-10-18-paste-dialog-oneline.md) -
  remove indents and join into one line (user request); `85a5c7edb2`, installed as vt-360 on
  desktop and m4max. Evidence: that session's verification.
