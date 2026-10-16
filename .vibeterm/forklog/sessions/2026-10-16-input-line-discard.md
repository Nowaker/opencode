# ctrl+u configurable as bash (to line start) or zsh (whole line)

## Identity

- Workday: 2026-10-16
- Session: `ses_eb98d3216ffe2113Brjvcvlgcr`
- Agent/platform: Sisyphus (anthropic/claude-opus-5-5, high) / linux
- Repository: `~/projekty/webapps/opencode`; opencode-tools
- Integration branch: `dev-nowaker`
- Development branch(es): `line-discard`; upstream `line-discard`
- Upstream base: `dfb56f76c7` (`v1.19.0`)
- Source result commit(s): `e0a1cc32e9`
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 41); the
verbatim request is in the
[feature record](../features/2026-10-16-input-line-discard.md#original-request).
The coordinator added: every opencode text field, an `opencodeTui.*` knob and
one setting for Vibeterm's own fields, the user's value left at the default,
real-terminal checks, both-host install, an upstream PR against v1.

## Goals

- `input.line_discard` (`bash` | `zsh`) decides ctrl+u in every opencode text
  field and every Vibeterm field.

## Constraints and non-goals

- No restart of `opencode-serve-tailscale`, `opencode-serve-lan` or any tab.
- The user's value stays unset (default `bash`).

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| opencode | `dev-nowaker` | `e5062b84ca` | `e0a1cc32e9` | fast-forward of `line-discard`, pushed to `origin` and `nowaker-github` |
| opencode | `line-discard` (upstream) | - | `9259db8ac0` | new, off `github/v1`, pushed to `nowaker-github`, PR #56246 |
| opencode-tools | `master` | `432826c5` | `5f9ef2bf` | Vibeterm fields read `input.line_discard`; knob catalog and Focus decision |

`070fe4290b` (`paste-modal-mode`, another session) landed on `dev-nowaker`
after `e0a1cc32e9`; this forklog commit sits above it.

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [ctrl+u deletes back to the line start, or the whole line](../features/2026-10-16-input-line-discard.md) | new | below |

## Other delivered work

- Upstream issue #56242 and PR #56246.
- opencode-tools `5f9ef2bf`: `discardLine` / `lineDiscardSetting` in
  `_lib/line-editor/index.ts`, used by `applyLineEdit`, the loading-screen
  draft, the session search box and a setting's value editor; catalog
  regenerated from `e0a1cc32e9`; global-only Focus decision; FEATURES.md and
  README. Collector restarted on desktop (systemd) and m4max (detached, new
  PID 47130); navbars restarted on both.

## Verification

- packages/tui: `bun typecheck` clean; `test/keymap.test.tsx`,
  `test/config.test.tsx`, `test/cli/tui/dialog-prompt.test.tsx`,
  `test/instant`: 79 pass, 0 fail (keymap test sends a real `\x15`; instant
  parity covers `zsh` from every caret). packages/opencode: typecheck clean;
  `test/config/tui.test.ts` and `test/cli/run`: 226 pass, 4 fail, the same 4
  plugin-merge tests that fail on unchanged `dev-nowaker`. Upstream branch:
  typecheck clean, 12 pass.
- Real PTY on the installed vt-321, isolated XDG home, throwaway tmux socket:
  `hello world`, cursor after `hello`, ctrl+u in the prompt gives ` world`
  (unset and `bash`) and an empty prompt (`zsh`); `first / hello world /
  last` with the cursor after `hello` gives `first /  world / last` (`bash`)
  and `first / (empty) / last` (`zsh`), ctrl+z restores; the command palette
  filter gives ` world` / empty. vt-319 gave ` world` in the prompt before.
- Vibeterm, real PTY: question pane comment box and drafts app filter give the
  same results under both values, and only the cursor's line changes in a
  multi-line comment.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh`
  in each host's primary checkout at `e0a1cc32e9`
- Installed artifact: `1.19.0-vt-321-dfb56f76c7`; desktop inode `49958239`,
  m4max inode `41909836`; v2 guard gate PASSED on both; retry marker present on
  both.
- Running services: desktop `opencode-serve-tailscale` PID `665762` and
  `opencode-serve-lan` PID `663085`, both started 03:05 CDT, not restarted; no
  tab restarted.

## Commit provenance

- `e0a1cc32e9` - source.
- Required trailer: `AI-Session-ID: ses_eb98d3216ffe2113Brjvcvlgcr`

## Unknowns and blocked verification

- The loading-screen draft editor was verified by unit test only; it runs only
  inside the opencode handoff loop.
