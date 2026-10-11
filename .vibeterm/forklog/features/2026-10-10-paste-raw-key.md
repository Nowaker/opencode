# Paste without a placeholder

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `prompt-paste-undo` (fork); `paste-raw-key` (upstream PR head `5294c452c1` on `v1` `dfb56f76c7`)
- First local commit: `549df87541`
- Current local commit(s): `549df87541`
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Upstream: PR [#54459](https://github.com/anomalyco/opencode/pull/54459) against `v1`. **Needs a v2 port later.**

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 28), quoting the user:

> paste without [ pasted content ] thing under a separate shortcut, e.g. leader -> v if it doesn't interfere with any default or my keybind. (what is my leader?)

## Goals

- `input_paste_raw` (default `<leader>v`, command `prompt.paste.raw`) pastes the clipboard as typed; an image is still attached.
- A terminal (bracketed) paste while the leader is pending goes in as typed and clears the leader: the path that carries the attached laptop's clipboard over ssh/tmux.

## Rationale and constraints

- `input_paste` and `input_paste_raw` read the clipboard of the machine opencode runs on (`clipboard.read`: wl-paste/xclip/osascript/clipboardy). From m4max attached to desktop that is desktop's clipboard, hence the leader-then-terminal-paste path.
- Leader is `ctrl+x`; `<leader>v` was unbound by default and in the hosts' `tui.json`.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `549df87541` | 2026-10-10 | raw paste key and leader-then-paste | `input_paste_raw` in `config/keybind-definitions.ts` and `keybind.ts` CommandMap; `prompt.paste.raw` command, `insertPastedText`, `normalizeLineEndings`, `onPaste` leader branch in `component/prompt/index.tsx`; keymap test "leader then v"; keybinds.mdx "Paste Without a Placeholder" |

## Verification

- `test/keymap.test.tsx` leader case passes.
- Real-PTY rig: ctrl+x then tmux `paste-buffer -p` inserted three lines as typed.

## Timeline

- 2026-10-10 [`ses_ed7634c31ffeH84yR0S99Ty8Nd`](../sessions/2026-10-10-prompt-paste-undo.md) - introduced. Evidence: commit above.
