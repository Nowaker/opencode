# Grouped prompt undo and redo on ctrl+z / ctrl+shift+z

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `prompt-paste-undo` (fork); `prompt-undo-history` (upstream PR head `8206ce472a`, stacked on `paste-placeholder-delete`)
- First local commit: `6a50eb5d4f`
- Current local commit(s): `ce41fc2f43`, `ac0d3e64b6` (fork-only defaults); `6a50eb5d4f`, `832a7fe5c0` before the v1 rebase
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `dfb56f76c7` (upstream `v1`, contains `v1.19.0`)
- Upstream: PR [#54460](https://github.com/anomalyco/opencode/pull/54460) against `v1`, keeping upstream's key defaults and showing the ctrl+z config. `832a7fe5c0` is fork-only. **Needs a v2 port later.**

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 28), quoting the user:

> undo/redo last prompt field action, keep X last actions, group actions wisely (e.g. adding a single letter is not a single action; but undoing the whole paragraph that took 20 minutes to write isn't a single action either) - sometimes being not careful and doing one ^U is disastrous, we need a way to undo it; ^Z / ^-shift-z are perfect for it. ^Z if not for being hidden by our vibeterm suspend opencode, which is silly, you don't ever intend to suspend a gui app; and if you do, you can bind suspend action to something else or just back to ^z. defaults: ^z ^s-z to undo/redo. pick sensible X last actions, but make it configurable too. undo/redo should work cross-prompts, e.g. if something just got submitted, ^Z-ing gets you the submitted content back (like pressing arrow up) [but doesn't abort the prompt running]

## Goals

- Typing groups by word; a pause over 1s, a caret move, or switching typing/deleting starts a group; a paste, word/line delete, newline, clear, history recall and submit are one step each.
- Each entry restores text, parts (pasted content, attachments), mode and caret.
- After a submit, undo restores what was sent without aborting the turn; redo empties again.
- `prompt.undo_depth` (default 500).
- Fork defaults: `input_undo` `ctrl+z,ctrl+-,super+z`, `input_redo` `ctrl+shift+z,ctrl+.,super+shift+z`, `terminal_suspend` `none`.

## Rationale and constraints

- The textarea's own undo stepped one character at a time, lost prompt parts (an undone placeholder deletion sent its label, not the pasted text) and was cleared by a submit.
- The history is module-level in `component/prompt/index.tsx` (`promptUndo`), shared by every prompt, so it survives the remount after a route change.
- Up to 16 characters inserted in one read still count as typing: tmux `send-keys` and a busy loop deliver several keys at once.
- Vibeterm masked ctrl+z in opencode panes by default (opencode-tools `shortcutMasks`); opencode-tools `0220818` drops that default and the shared settings set `shortcutMasks: []`.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `6a50eb5d4f` | 2026-10-10 | grouped history, cross-prompt, `prompt.undo_depth` | `createPromptUndo`, `copyPromptParts` in `packages/tui/src/prompt/undo.ts`; `promptUndo`, `observeUndo`, `stepUndo`, `input.undo` / `input.redo` command override in `component/prompt/index.tsx`; `Prompt.undo_depth` in `config/index.tsx`; `test/prompt/undo.test.ts`, `test/component/prompt-undo.test.tsx`; tui.mdx "Undo in the prompt"; keybinds.mdx "Undo with ctrl+z" |
| `832a7fe5c0` | 2026-10-10 | fork defaults ctrl+z / ctrl+shift+z, suspend unbound | `input_undo`, `input_redo`, `terminal_suspend` in `config/keybind-definitions.ts`; `test/config.test.tsx`, keymap byte-form test |

## Verification

- `undo.test.ts` 13 pass; `prompt-undo.test.tsx` 3 pass, all 3 fail on the textarea's own undo.
- Keymap test: `\x1a`, `\e[27;6;90~`, `\e[27;6;122~`, `\e[90;6u`, `\e[122;6u` dispatch undo / redo.
- Real-PTY rig: `hello brave world`, ctrl+u, then ctrl+z gave `hello brave world`, `hello brave`, `hello`; ctrl+shift+z redid; after a submit during a streaming turn ctrl+z restored the prompt, the turn kept streaming, redo emptied it.
- Key bytes through tmux with Vibeterm's bindings: see the session record.

## Timeline

- 2026-10-10 [`ses_ed7634c31ffeH84yR0S99Ty8Nd`](../sessions/2026-10-10-prompt-paste-undo.md) - introduced. Evidence: commits above.
- 2026-10-11 [`ses_ed5f9f826ffeno6fI51rL96d5Q`](../sessions/2026-10-11-upstream-v1-19.md) -
  rebased unchanged onto upstream `v1` `dfb56f76c7` (`v1.19.0`).
  Evidence: patch-identical in `git range-diff`; that session's gates.
- 2026-10-12 [`ses_ece4671adffe4Y4d8Yv35NSjXh`](../sessions/2026-10-12-v1-v2-patch-rig.md) -
  rig run: `prompt-undo-history` applies on `v1.19.0`; v2 port cost L. See the [matrix](../README.md#tui-patches-on-v1-and-v2).

## Current maintenance notes

- An opentui textarea undo change does not affect this: `input.undo` / `input.redo` are overridden by the prompt's own commands while it is focused.
