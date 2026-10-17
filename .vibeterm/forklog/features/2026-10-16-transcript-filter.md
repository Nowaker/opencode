# Transcript filter: choose which kinds of entries the transcript shows

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `transcript-filter` (worktree `.vibeterm/worktrees/transcript-filter`)
- First local commit: `de17779440`
- Current local commit(s): `de17779440`, `3c8c11a4f3`
- Upstream base when introduced: `dfb56f76c7` (upstream `v1`, contains `v1.19.0`)
- Last checked against upstream: `dfb56f76c7` (upstream `v1`, contains `v1.19.0`)
- Upstream: no PR. It does not stand alone on `v1`: it needs `bashFileAction`'s home `util/file-output.ts` (`syntax.file_output`, PR #56007 on #54968), `onClick` from `ui/click.ts` (click controls, PR #53871) and the `transcript` config group (history crop, PR #53660). **Needs a v2 port later (L: v2 transcript rewritten).**

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` as item 42, quoting the user:

> filtering: introduce a modal list with checkboxes of all chat log filtering rules. should be able to easily show/filter out:
> - thinking blocks
> - tool calls
>   - second level selection for this one with checkboxes, could show 10 most frequent one (calculated here probably? if it's not expensive)
>   - shows if tool calls isn't checkboxed (if it is it means all tool calls show) - this allows to say 'only show these'
> - file actions
>   - same like tool calls but centered on file reads, edits and greps
> - todos
> - questions
> - user prompts
> - final ai answers
> - ...any other type of messages; sort them by importance level
>
> checkbox tick = display.

## Goals

- `/filter`, `ctrl+x f` (`session_transcript_filter`) or **Filter transcript** opens a checkbox list of every kind of entry, most important first: Prompts, Final answers, Questions, Errors, Notices, Todos, Subagents, Progress notes, File actions, Tool calls, Thinking, Compaction markers, Turn footers. Each row shows how many are loaded.
- Unticking Tool calls shows the session's ten most used tools plus Other tools, so ticking some means only those; File actions does the same over edits, reads and searches.
- Arrows move, space or a click toggles, the wheel scrolls, enter or esc closes; the transcript changes live.
- `transcript.show.<kind>` in tui.json sets defaults per kind (`tools` and `file_actions` also take a list), under the toggle-precedence rule; unset kinds persist in kv.json `transcript_filter`.

## Non-goals

- Changing how an entry renders when shown (`/thinking` still expands or collapses thinking; tool output collapse is unchanged).
- Filtering the export: the export dialog only starts from the Thinking, Tool calls and Turn footers rows.

## Rationale and constraints

- One source of truth: "Show/Hide tool details" (kv `tool_details_visibility`) is the Tool calls row and is renamed "Show/Hide tool calls"; kv `assistant_metadata_visibility` is Turn footers. Questions, todos, subagents and file actions, which "Hide tool details" used to hide, follow its saved value until chosen on their own, and are pinned before Tool calls changes.
- File actions: the read, edit, write, apply_patch, multiedit, patch, grep, glob and list tools, plus bash commands `bashFileAction` reads as pure reads or searches (same pipeline reading as `commandLanguage`: cat, head, tail, sed, grep, rg, git show `<ref>:<path>`, filters after them); a redirect or `sed -i` excludes the call.
- A running tool call, a block still thinking and a response still streaming always show; a failed tool call shows while Errors is ticked.
- Notices are user messages whose every text part is `ignored` (Vibeterm's `user_message`).
- Hidden entries stay mounted with `visible=false` (yoga `display: none`): re-showing costs a layout pass, not a remount, and expanded blocks come back expanded. `setPreLayoutSiblingMargin` takes the last visible sibling as the previous one, so nothing leaves a gap; Solid placeholders still count, as before.
- The selection is a store reconciled from `resolve()`, so a toggle reaches only the entries of the kind it changes; each tool part's entry is memoized, so bash commands are parsed once, not per toggle.
- When everything loaded is hidden, one line names the hidden kinds and opens the dialog on click.
- Counts and the top ten tools are computed once when the dialog opens.
- Long tool names (MCP prefixes) are cut in the middle to the measured list width.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `de17779440` | 2026-10-16 | Filter model, dialog, renderer wiring, schema, docs | `Kinds`, `FileActions`, `resolve`, `showsTool`, `toolEntry`, `userKind`, `anyShown`, `count`, `toggleKind`, `toggleName`, `KVKey` in `packages/tui/src/routes/session/transcript-filter.ts`; `DialogTranscriptFilter` in `routes/session/dialog-transcript-filter.tsx`; `filter` context, `Filtered`, `FilteredNotice`, `session.transcript_filter` and the `session.toggle.actions` rewrite in `routes/session/index.tsx`; `bashFileAction` in `util/file-output.ts`; `previousSiblings` in `util/layout.ts`; `TranscriptShow` in `config/index.tsx`; `session_transcript_filter` in `config/keybind-definitions.ts`/`keybind.ts`; tui.mdx "Transcript filter", keybinds.mdx; `test/routes/session/transcript-filter.test.ts`, `transcript-filter-dialog.test.tsx` |
| `3c8c11a4f3` | 2026-10-16 | Long tool names cut in the middle | `listWidth`/`label` in `dialog-transcript-filter.tsx` |

## Verification

- `packages/tui`: typecheck clean; full suite 782 pass, 0 fail on `3c8c11a4f3` (base before: 758 pass).
- Toggle timing and the real PTY check: see the session record.

## Timeline

- 2026-10-16 [`ses_eb93ce62fffekug2rIeYIQFnpF`](../sessions/2026-10-16-transcript-filter.md) - introduced; vt-327 on desktop and m4max; opencode-tools `ea05c72b` makes the boolean kinds Vibeterm knobs. Evidence: commits above, that session's verification.

## Current maintenance notes

- A new transcript entry kind needs a `Kinds` row, a `TranscriptShow` key, a branch in `count`/`anyShown` and the renderer's `visible`, and a `KV_TOGGLES` entry in opencode-tools.
- `transcript.show.tools` and `.file_actions` take a boolean or a list, which the opencode-tools catalog does not model; they stay tui.json-only.
