# Editor-standard Home and End defaults

## Identity

- Workday: 2026-10-09
- Session: `ses_ef46f1775ffe29MtElYF4DQySL`
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `home-end-keys` (worktree off `dev-nowaker` `b79f6659f7`)
- Upstream base: `907b3bc518` (upstream `dev`); unchanged
- Source result commit(s): `680e8a0daa`
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`:

> Switch the FORK's default Home/End keybinds ... to the editor-standard
> scheme. The user approved it after a Perplexity survey of VS Code,
> Microsoft and Slack conventions.

## Goals

- Editor-standard Home/End defaults with no key shared between the prompt and
  conversation scrolling; matching composer fallback in opencode-tools.

## Constraints and non-goals

- Fork-only; no upstream PR. PRs #53333 and #53630 untouched: their defaults
  did not change.
- Hosts' `tui.json` already set this scheme; left unchanged.
- No TUI tab, service or vibeterm tmux server restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `b79f6659f7` | `680e8a0daa` + this forklog commit | commit on `home-end-keys`, fast-forward; pushed to `origin` and `nowaker-github` |
| `opencode-tools` | `master` | `973bde3` | `d8c6969` | `COMPOSER_KEYBIND_DEFAULTS` to `ctrl+end` / `ctrl+home`, fast-forward; pushed to `origin` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Editor-standard Home and End defaults](../features/2026-10-09-editor-home-end.md) | introduced | `680e8a0daa`; keymap tests; Ghostty and VibeTerm.app rigs |
| [Return to the scrolled-up position on messages_first](../features/2026-10-06-tui-home-return.md) | changed key | `messages_first` / `messages_last` now `ctrl+alt+home` / `ctrl+alt+end` |
| [Navigate the transcript by prompt, landmark and block](../features/2026-10-05-tui-block-nav.md) | changed key | `ctrl+home` / `ctrl+end` now move within the prompt |

## Other delivered work

- opencode-tools `d8c6969`: composer delivery falls back to `C-End` for an
  unset `input_buffer_end`. The composer-caret e2e against the installed
  `1.18.34-vt-192` build passes with it and fails on the old `end` fallback.
- Ghostty swallows `shift+home` / `shift+end` (its default
  `scroll_to_top` / `scroll_to_bottom`); reported, not changed.

## Verification

- `bun typecheck` in `packages/tui` exit 0; `bun test --timeout 60000` 382
  pass. opencode-tools `composer-keybind.test.ts` 27 pass; 5 `pane-deliver`
  tests fail identically on `973bde3` (`cannot identify submission target
  pane`), pre-existing.
- Rigs: see the feature record's Verification section.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard ~/projekty/webapps/opencode-build/build.sh`
  on desktop (the first run without it stopped at the gate, installing
  nothing); `.vibeterm/build.sh` with the same `VIBETERM_V2_GUARD` on m4max
  after fast-forwarding its checkout to `680e8a0daa` and its opencode-tools
  to `d8c6969`.
- v1 database guard gate: PASSED on both hosts.
- Installed artifact: desktop `1.18.34-vt-192-907b3bc518` (inode `49946767`),
  contains `ctrl+g,ctrl+alt+home`, `ctrl+e,end` and the retry-header marker.
  m4max `1.18.34-vt-192-907b3bc518` (inode `24735482`), same checks; its
  retry diff matched the canonical patch too.
- Retry-header cap: the dirty diff matched the canonical patch before the
  build.
- Running services: none restarted; `opencode-serve-tailscale` PID `3975662`
  and `opencode-serve-lan` PID `3975666` unchanged.

## Commit provenance

- `680e8a0daa` - Home/End defaults.
- Required trailer: `AI-Session-ID: ses_ef46f1775ffe29MtElYF4DQySL`

## Unknowns and blocked verification

- The physical Karabiner-remapped chord on the Macs was not posted; System
  Events posts post-remap keys.
