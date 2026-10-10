# Editor-standard Home and End regression from m4max

## Identity

- Workday: 2026-10-10
- Session: `ses_ef46f1775ffe29MtElYF4DQySL`
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `home-end-keys` (worktree, at `dev-nowaker` `64576e80e5`)
- Upstream base: `907b3bc518` (upstream `dev`); unchanged
- Source result commit(s): `ab1574bed8`
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, quoting the owner
testing from m4max attached to desktop with `vibeterm desktop.ts.nowaker.net`:

> subsequent end presses jump weirdly; end goes to line end, then end goes to
> next line beginning?? then end. unacceptable. wtf is that. home works like
> that too. ctrl+home/end no difference, like without control. c-a-Home/end
> don't work.

## Goals

- Repeated home/end stay at the line edge; ctrl+home/end and ctrl+alt+home/end
  work through the m4max client.

## Constraints and non-goals

- No GUI takeover on m4max; the real-client runs used m2pro.
- No TUI tab, service or vibeterm tmux server restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `64576e80e5` | `ab1574bed8` + this forklog commit | fix commit on `home-end-keys`, fast-forward; pushed to `origin` and `nowaker-github` |
| `dotfiles` | `master` | `821a523` | `f201350` | Terminal.app VibeTerm profile Home/End rows, from worktree `terminal-home-end`; pushed to `origin` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Editor-standard Home and End defaults](../features/2026-10-09-editor-home-end.md) | fixed | `ab1574bed8`; keymap and instant parity tests; remote Terminal.app run |

## Other delivered work

- Root causes: opentui's `gotoLineEnd` / `gotoLineHome` step to the next /
  previous line at the edge (the owner's `tui.json` had bound home/end to line
  start/end since at least 2026-08-27, so this was not new code path, but the
  new defaults made it the main path); and the Terminal.app VibeTerm profile
  (the m4max client, launched by `tvibeterm`) had no Home/End modifier rows.
  Measured from m2pro Terminal.app over ssh into a desktop tmux socket:
  ctrl+home `ESC[1~`, ctrl+option+home `ESC[1~`, shift+home nothing.
- Not the cause: opencode-tools `d8c6969` (composer delivery only) and
  dotfiles `f926079` (Linux Ghostty vibeterm instance only).
- dotfiles `f201350`: `ESC[1;<mod>H/F` rows for ctrl, option, ctrl+option and
  their shift forms; spec 13 pass on m4max; installed on m4max and m2pro
  (`--check` matching). Plain shift+home/end stays Terminal's own scroll.

## Verification

- `bun typecheck` exit 0; `bun test --timeout 60000` in `packages/tui` 382
  pass; the keymap test presses home and end twice on a two-line draft.
- Manual surface: see the feature record's 2026-10-10 Verification entry.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard`
  with `~/projekty/webapps/opencode-build/build.sh` on desktop and
  `.vibeterm/build.sh` on m4max.
- v1 database guard gate: PASSED on both hosts.
- Installed artifact: desktop `1.18.34-vt-194-907b3bc518` (inode `49952705`),
  m4max `1.18.34-vt-194-907b3bc518` (inode `26550386`); both contain the line
  edge commands and the retry-header marker.
- Retry-header cap: the dirty diff matched the canonical patch on both hosts.
- Running services: none restarted; `opencode-serve-tailscale` PID `2157240`
  and `opencode-serve-lan` PID `2157284` unchanged.

## Commit provenance

- `ab1574bed8` - line edge fix.
- Required trailer: `AI-Session-ID: ses_ef46f1775ffe29MtElYF4DQySL`

## Unknowns and blocked verification

- Physical Karabiner chords on m4max not posted; m2pro posts post-remap keys.
- The owner's running Terminal.app keeps its loaded profile until it
  restarts.
