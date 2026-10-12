# Prompt start height, percentage sizes and home screen layout

## Identity

- Workday: 2026-10-12
- Session: `ses_ece469f46ffeIkbDfxO1jJY6D6`
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`; also `~/projekty/nowaker/opencode-tools`
- Integration branch: `dev-nowaker`
- Development branch(es): `home-layout` (off `dev-nowaker`); upstream
  `prompt-fit-screen` and `home-layout-options` (off `github/v1`)
- Upstream base: `dfb56f76c7` (upstream `v1`, `v1.19.0`); unchanged
- Source result commit(s): `7a377b7324`
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` as item 34; quoted in
[the feature record](../features/2026-10-12-home-screen-layout.md#original-request).

## Goals

- The prompt never grows past the screen (home and session).
- `prompt.min_height`; percentages for `min_height`, `max_height`, `max_width`.
- Logo top gap shrinks to one row.
- `home.logo`, `home.tips`, `home.prompt_position`; fork defaults match upstream,
  Vibeterm writes its own (tips and logo hidden).

## Constraints and non-goals

- No tab, serve unit or `vibeterm` tmux server restarted.
- No v2 port in this session.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `091e060773` | `7a377b7324` + this record's forklog commit | `home-layout` rebased over items 19's commits, fast-forward; pushed to both remotes |
| `opencode` | `prompt-fit-screen` | - | `2e01aa0916` | new, off `github/v1`; PR #54948 (issue #54946) |
| `opencode` | `home-layout-options` | - | `bb8d1d9987` | new, stacked on `prompt-fit-screen`; PR #54949 (issue #54947) |
| `opencode-tools` | `master` | `e42fcbd` | `1cb6027` | Vibeterm tui.json defaults; fast-forward, pushed |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Prompt start height, percentage sizes and home screen layout](../features/2026-10-12-home-screen-layout.md) | new | `7a377b7324` |
| [Instant home and session prompt](../features/2026-10-06-tui-instant-prompt.md) | changed | frame follows the new settings; parity cases in `test/routes/home-layout.test.tsx` |

## Other delivered work

- opencode-tools `1cb6027`: the collector writes `home.tips: false` and
  `home.logo: false` into the global `tui.json` once per machine, never over a
  set value and never again after a removal (`_lib/opencode-tui-knobs/defaults.ts`,
  `seeded.json`); Vibeterm's tui.json reader and knob catalog accept percentage
  sizes; catalog regenerated (59 knobs). Applied on desktop (collector restart)
  and m4max (collector replaced through `ensure-collector.sh`): both `tui.json`
  files gained only the `home` block.

## Verification

- packages/tui: typecheck clean; full suite 603 pass, 0 fail after the rebase.
  packages/opencode typecheck clean.
- Upstream branches: `prompt-fit-screen` 207 pass, `home-layout-options` 212
  pass, typecheck clean on both.
- opencode-tools: `_lib/opencode-tui-knobs` + `_lib/opencode-tui-config` 46 pass;
  collector 189 pass; 6 `prompt-draft` tmux tests fail identically on master.
- Real PTY, throwaway tmux sockets, isolated `XDG_*`: fork and both upstream
  branches; overflow, resize to 60x14, top/bottom positions, percentages.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh`
  on desktop and m4max.
- v2 migration guard gate: PASSED on desktop (2026-10-12T22:29:43Z) and m4max
  (2026-10-12T22:31:35Z).
- Installed artifact: desktop `1.19.0-vt-250-dfb56f76c7` (inode `49962237`),
  m4max `1.19.0-vt-250-dfb56f76c7` (inode `31223363`); both carry the retry marker.
- Running services: desktop `opencode-serve-tailscale` PID `4038768`, started
  2026-10-12 03:45:55 CDT, unchanged.

## Commit provenance

- `7a377b7324` - size the prompt from the room it has and lay out the home screen
- Required trailer: `AI-Session-ID: ses_ece469f46ffeIkbDfxO1jJY6D6`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-12-home-screen-layout.md
```

## Unknowns and blocked verification

- Running TUI tabs pick up the build only when restarted; none was restarted.
- Vibeterm's own loading-screen draft (`prompt-draft-geometry.ts`) does not
  follow `home.logo`, `home.prompt_position`, `min_height` or percentages; it
  shows only under `loadingScreen.newSession: vibeterm` or a restored draft.
