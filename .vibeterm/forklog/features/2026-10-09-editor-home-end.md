# Editor-standard Home and End defaults

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `home-end-keys` (worktree off `dev-nowaker` `b79f6659f7`)
- First local commit: `680e8a0daa`
- Current local commit(s): `680e8a0daa`
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `907b3bc518` (upstream `dev`)
- Upstream: none; a fork-only default change

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` on 2026-10-09, after
the user approved the scheme from a survey of VS Code, Microsoft and Slack
conventions:

> Switch the FORK's default Home/End keybinds ... to the editor-standard
> scheme.

## Goals

| Keybind | Before | After |
|---|---|---|
| `input_line_home` / `input_line_end` | `ctrl+a` / `ctrl+e` | `ctrl+a,home` / `ctrl+e,end` |
| `input_select_line_home` / `_end` | `ctrl+shift+a` / `ctrl+shift+e` | adds `shift+home` / `shift+end` |
| `input_buffer_home` / `input_buffer_end` | `home` / `end` | `ctrl+home` / `ctrl+end` |
| `input_select_buffer_home` / `_end` | `shift+home` / `shift+end` | `ctrl+shift+home` / `ctrl+shift+end` |
| `messages_first` / `messages_last` | `ctrl+g,home,ctrl+home` / `ctrl+alt+g,end,ctrl+end` | `ctrl+g,ctrl+alt+home` / `ctrl+alt+g,ctrl+alt+end` |

- No default stroke is shared between `input_*` and `messages_*`.

## Non-goals

- No upstream PR. Upstream keeps `home` on both `input_buffer_home` and
  `messages_first`.
- The hosts' `tui.json` already set exactly this scheme and was not changed.

## Rationale and constraints

- Before, `home` / `end` were bound to both the prompt's buffer ends and the
  conversation's first/last, so the key's effect depended on which layer the
  keymap resolved, and the prompt had no Home/End for line navigation.
- The return-to-mark on `messages_first`
  ([feature](./2026-10-06-tui-home-return.md)) follows the command, so it
  moves to `ctrl+alt+home` with it.
- The which-key panel keeps `ctrl+alt+home` / `ctrl+alt+end`; its layer is
  enabled only while the panel is open (priority 1000), so it takes the keys
  only then.
- Ghostty binds `shift+home=scroll_to_top` and `shift+end=scroll_to_bottom`
  by default and the hosts' Ghostty config does not unbind them, so in Ghostty
  `shift+home` / `shift+end` never reach opencode. VibeTerm.app (SwiftTerm)
  delivers them.
- opencode-tools' composer delivery falls back to the fork default for
  `input_buffer_end`; `d8c6969` moved that fallback from `end` to `ctrl+end`.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `680e8a0daa` | 2026-10-09 | editor-standard Home/End defaults | the ten defaults in `packages/tui/src/config/keybind-definitions.ts`; `keybinds.mdx` defaults; "Home and End" in `tui.mdx`; `keymap.test.tsx` "share no key" and "home and end keys reach the prompt or the conversation"; `test/instant/editor.test.ts` defaults |

## Verification

- `bun typecheck` and `bun test --timeout 60000` in `packages/tui`: 382 pass,
  0 fail. The keymap test sends the bytes tmux delivers (`\e[1~`, `\e[4~`,
  `\e[1;5H`, `\e[1;5F`, `\e[1;7H`, `\e[1;7F`) to a focused textarea under the
  real keymap: the prompt moves for home/end/ctrl+home/ctrl+end, and only
  ctrl+alt+home/end run `session.first` / `session.last`.
- Real-client rig, Linux: Ghostty 1.3.1 with the hosts' keybind config on a
  private Xvfb display, attached to a throwaway socket of the forked tmux
  (`extended-keys on`, format `xterm`, Vibeterm's `terminal-features`), keys
  posted with XTEST. Bytes: `ctrl+alt+home/end` `\e[1;7H` / `\e[1;7F`,
  `ctrl+home/end` `\e[1;5H/F`, `ctrl+shift+home/end` `\e[1;6H/F`, `home/end`
  `\e[1~` / `\e[4~`; `shift+home/end` nothing (Ghostty). With the worktree TUI
  on an imported session, `ctrl+alt+home` showed `PROMPT 1` at the top,
  `ctrl+alt+end` the last reply, and a two-line draft became
  `Xalpha beta` / `Zgamma deltaY` after ctrl+home X, ctrl+end Y, home Z.
- Real-client rig, macOS: VibeTerm.app on m2pro as an isolated
  `--second-for-testing` probe whose child records stdin, chords posted with
  System Events: `ctrl+option+home/end` `\e[1;7H` / `\e[1;7F`, `shift+home`
  `\e[1;2H`, every other chord as on Linux.
- Vibeterm's tmux binds nothing on `C-M-Home` / `C-M-End` in any table.

## Timeline

- 2026-10-09
  [`ses_ef46f1775ffe29MtElYF4DQySL`](../sessions/2026-10-09-editor-home-end.md)
  - `680e8a0daa`: introduce; build and install on desktop and m4max.

## Current maintenance notes

- Keep `COMPOSER_KEYBIND_DEFAULTS` in opencode-tools
  `_lib/vibeterm-tmux/composer-keybind.ts` equal to `input_buffer_*` here.
- On an upstream bump, re-check that upstream did not add a default that
  collides with these keys; the "share no key" test catches `input_*` vs
  `messages_*`.

### Upstream integration checklist

- Locate the ten defaults in `keybind-definitions.ts`.
- Run `test/keymap.test.tsx` and `test/instant/editor.test.ts` and
  `bun typecheck` in `packages/tui`.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
