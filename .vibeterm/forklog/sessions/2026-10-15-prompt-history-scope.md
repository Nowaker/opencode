# Prompt history scoped to the session, and Vibeterm defaults enforced while unset

## Identity

- Workday: 2026-10-15
- Session: `ses_ebdf069dbffeooZAqUSORaYd5z`
- Agent/platform: Sisyphus (anthropic/claude-opus-5-5, high) / linux
- Repository: `~/projekty/webapps/opencode`; opencode-tools
- Integration branch: `dev-nowaker`
- Development branch(es): `prompt-history-scope`; upstream `history-scope`
- Upstream base: `dfb56f76c7` (`v1.19.0`)
- Source result commit(s): `59deec6f56`
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 38); the
verbatim request is in the
[feature record](../features/2026-10-15-prompt-history-scope.md#original-request).
The coordinator added: opencode default `global`, Vibeterm default `session`
enforced while Vibeterm settings hold no value, the settings row flagged as
following the Vibeterm default, a real-terminal check, both-host install, an
upstream PR against v1.

## Goals

- Up / down in a session recall only that session's prompts when
  `prompt.history_scope` is `session`.
- Vibeterm's tui.json defaults enforced until the user sets a value, replacing
  the write-once `seeded.json`.

## Constraints and non-goals

- No restart of `opencode-serve-tailscale`, `opencode-serve-lan` or any tab.
- tui.json knobs change only through Vibeterm settings.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| opencode | `dev-nowaker` | `fb4acfccf5` | `59deec6f56` | fast-forward of `prompt-history-scope`, pushed to `origin` and `nowaker-github` |
| opencode | `history-scope` | - | pushed to `nowaker-github` | new, off `github/v1`, PR #55902 |
| opencode-tools | `master` | `b27b7330` | `7bc57a3d` | Vibeterm defaults enforced while unset; `prompt.history_scope` default `session` |

`baba8723fe` (`config-walk-root`, another session) landed on `dev-nowaker`
after `59deec6f56`; this forklog commit sits above it.

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Prompt history scoped to the session](../features/2026-10-15-prompt-history-scope.md) | new | below |

## Other delivered work

- opencode-tools `7bc57a3d`: `withVibetermDefaults` / `migrateSeededDefaults`
  in `_lib/opencode-tui-knobs/defaults.ts`; `opencodeTui.released`; knob rows
  read `Vibeterm default, applied to tui.json - nothing set here`; catalog
  regenerated from `59deec6f56`; Focus decision; FEATURES.md and README.
- Collector restarted on desktop (systemd) and m4max (detached singleton);
  both retired `seeded.json` releasing nothing and wrote
  `prompt.history_scope: "session"` into tui.json.

## Verification

- packages/tui: `bun typecheck` clean; `bun test test/prompt test/config.test.tsx`
  123 pass, 0 fail. Upstream branch: typecheck clean, 34 pass.
- Real PTY, isolated XDG home, fake provider, throwaway tmux socket, two
  processes, shell-mode prompts. `session`: B recalled only `echo beta-1`;
  reopened A recalled `echo alpha-2` then `echo alpha-1`, in shell mode, nothing
  of B's. `global`: B recalled `echo beta-1`, `echo alpha-2`, `echo alpha-1`.
  The first prompt sent from the home screen was stored with its new session.
- opencode-tools: `bun test _lib/opencode-tui-knobs/` and the knob, focus,
  layout, config-knob and explanation suites pass except failures master
  already has (`workspace.roots`, three explanation tests on other settings).

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh`
  in each host's primary checkout at `59deec6f56`
- Installed artifact: `1.19.0-vt-304-dfb56f76c7`; desktop inode `49954272`,
  m4max inode `41125869`; v2 guard gate PASSED on both; retry marker present on
  both.
- Running services: desktop `opencode-serve-tailscale` PID `914944` and
  `opencode-serve-lan` PID `910216` unchanged; no tab restarted.

## Commit provenance

- `59deec6f56` - source.
- Required trailer: `AI-Session-ID: ses_ebdf069dbffeooZAqUSORaYd5z`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-15-prompt-history-scope.md
```

## Unknowns and blocked verification

- The settings-screen row was verified through `settingsRows` on both hosts
  (value text and bright marker), not by driving the sidebar in a terminal.
- No v1/v2 patch-rig scenario added.
