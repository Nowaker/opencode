# ctrl+u deletes back to the line start, or the whole line

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `line-discard` (worktree off `dev-nowaker`);
  upstream branch `line-discard` (`Nowaker/opencode`), off `github/v1`
  `dfb56f76c7`
- First local commit: `e0a1cc32e9`
- Current local commit(s): `e0a1cc32e9`
- Upstream base when introduced: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Last checked against upstream: `dfb56f76c7`
- Upstream: PR [#56246](https://github.com/anomalyco/opencode/pull/56246)
  against `v1`, closes issue
  [#56242](https://github.com/anomalyco/opencode/issues/56242); upstream
  commit `9259db8ac0`. **Needs a v2 port later.**

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 41), the user
verbatim:

> make ^u in text fields configurable behavior: default like in bash, only
> from cursor backwards; or like in zsh; entire line.

## Goals

- `input.line_discard` in tui.json: `bash` (default, unchanged) deletes from
  the cursor back to the start of its line; `zsh` deletes that whole line
  wherever the cursor is.
- Every opencode text field: the prompt, question and permission replies,
  dialog prompts, the paste and export editors, select-dialog filters
  (`<input>`), the `run` footer and the instant startup prompt.
- Vibeterm's own fields follow the same tui.json value (opencode-tools
  `5f9ef2bf`), so the user sets it once.

## Non-goals

- Changing `input_delete_to_line_end` (ctrl+k) or `input_delete_line`.
- A kill ring: the deleted text goes to undo history, as before.

## Rationale and constraints

- "Line" is the cursor's logical line in both modes, never the rest of a
  multi-line prompt and never the visual (wrapped) row.
- `zsh` moves the cursor to the line end and runs opentui's
  `deleteToLineStart`, so both modes keep its edge behaviour (a press at the
  start of a line, or on an empty one, joins it to the line above) and
  `input_undo` restores the text.
- A single-line `<input>` handles ctrl+u natively, outside the managed
  textarea layer; a second binding layer routes it to the same command while
  an `<input>` has focus.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `e0a1cc32e9` | 2026-10-16 | `input.line_discard`; command override for textarea and `<input>`; run-mode and instant prompt wiring; docs; tests | `discardLine` in `packages/tui/src/util/line-discard.ts`; `registerLineDiscardCommand` in `packages/tui/src/keymap.tsx`; `Input` in `config/index.tsx`; `delete_to_line_start` in `instant/editor.ts` and `lineDiscard` in `instant/config.ts`; `RunTuiConfig` `input` in `cli/cmd/run/types.ts` / `runtime.boot.ts`; `input.line_discard` bullet in `tui.mdx` |

## Verification

Reported by `ses_eb98d3216ffe2113Brjvcvlgcr`; see its
[session record](../sessions/2026-10-16-input-line-discard.md).

## Timeline

- 2026-10-16 [`ses_eb98d3216ffe2113Brjvcvlgcr`](../sessions/2026-10-16-input-line-discard.md) -
  initial build, upstream issue #56242 and PR #56246, vt-321 on both hosts,
  Vibeterm fields on the same value. Evidence: `e0a1cc32e9`; PTY checks.

## Current maintenance notes

- The upstream branch has no instant startup prompt; its commit drops those
  hunks. The fork commit keeps them and a parity test for both modes.
- The upstream branch carries no AI trailers; the fork commit does.
