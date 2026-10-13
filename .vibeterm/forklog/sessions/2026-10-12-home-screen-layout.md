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
- Source result commit(s): `7a377b7324`, `f77943745f`
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
| `opencode-tools` | `master` | `1cb6027` | `a2851e7` | loader draft follows the fork's home layout; fast-forward, pushed |
| `opencode` | `dev-nowaker` | `246c6c10f2` | `f77943745f` + this record's second forklog commit | regression fix, fast-forward; pushed to both remotes |
| `opencode` | `home-layout-options` | `bb8d1d9987` | `115c96ec28` | amended, force-pushed with lease; PR #54949 body updated |
| `opencode-tools` | `master` | `d612f5b` | `892927e` | tips precedence, bottom draft, home prompt heights; fast-forward, pushed |

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

## Regressions on vt-252

Reported by the coordinator for the user on desktop: "bottom alignment leaves a
lot of space between, plus tips are actually showing despite being off by
default in vt", and then, verbatim: "we should have a separate tui config for
minimum height of prompt window on new session screen, and in session view
screen. [...] in new session, it can take all. here, nah, i want 35% for me
here."

- Tips cause: `homeTipsShown` let any boolean `tips_hidden` in kv.json win, and
  desktop's kv.json held `tips_hidden: false` from an earlier toggle. Now a set
  `home.tips` decides on every start and the toggle lasts until exit; unset, the
  toggle is remembered. Same rule as `footer`; item 36 adopts it for every
  tui.json/kv overlap. `home.logo` has no runtime toggle.
- Gap cause: at `bottom` the tips block (`paddingTop` 3 plus the tip) stayed
  below the prompt, between it and the footer. The tips now go above the logo
  at `bottom`; with tips hidden the prompt was already flush.
- Per-screen heights: `home.prompt_min_height` / `home.prompt_max_height`, each
  falling back to `prompt.*`, so nothing changes until they are set.
  `prompt.max_width` stays shared: it only ever applied to the home prompt.
- Verification: packages/tui typecheck clean, full suite 628 pass, 0 fail;
  `home-layout-options` 214 pass. Real PTY at 160x45 with the user's config and
  `tips_hidden: false`: no tip, status row on the footer, 12-row start (35%),
  grows to row 1. Installed binaries checked the same way on desktop and m4max.
- Migration: desktop and m4max `tui.json` gained `home.prompt_min_height: "35%"`
  and lost `prompt.min_height: 8`; backups `tui.json.bak-before-home-prompt-split`.
- Build: desktop `1.19.0-vt-260-dfb56f76c7` (inode `49959250`), m4max
  `1.19.0-vt-261-dfb56f76c7` (inode `31438362`); v2 gate PASSED on both, retry
  marker present; desktop `opencode-serve-tailscale` PID `5053` untouched.

## Commit provenance

- `7a377b7324` - size the prompt from the room it has and lay out the home screen
- `f77943745f` - let home.tips decide, keep a bottom prompt on the footer, size the home prompt apart
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
