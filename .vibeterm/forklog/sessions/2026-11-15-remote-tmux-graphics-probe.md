# Kitty graphics query in the tmux pane title over ssh

## Identity

- Workday: 2026-11-15
- Session: `ses_e215062b9ffe020IfGlqnRnuPu`
- Agent/platform: opencode, `anthropic/claude-opus-5-5` / linux (desktop), builds on desktop and m4max
- Repository: `~/projekty/webapps/opencode` (desktop), `~/projects/webapps/opencode` (m4max)
- Integration branch: `dev-nowaker`
- Development branch(es): `fix/opentui-remote-tmux-probe`
- Upstream base: `006d837c50` (`v1.19.5`)
- Source result commit(s): `9973164c6c`
- Forklog commit: this file's introducing commit

## User requests

From coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv); the defect was found by [`ses_e2562f980ffe48VSWDL6KYVPBb`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e2562f980ffe48VSWDL6KYVPBb):

> Find how opencode consumes this fork (opencode-tools _lib/vibeterm-forks registry and the opencode fork's package/build at ~/projekty/webapps/opencode, .vibeterm/build.sh) and follow that path

Build slot granted by [`ses_e383ee7faffe6JX8m2EP26dXUC`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e383ee7faffe6JX8m2EP26dXUC) at 12:11Z, for desktop and then m4max.

## Goals

- opencode in a tmux pane that inherited `SSH_*` keeps its pane title.

## Constraints and non-goals

- Restart no tabs, serve units, vibeterm-api or collector; running tabs pick the binary up when they next start.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| opencode | `dev-nowaker` | `41ef5eda50` | `9973164c6c` | fast-forward of `fix/opentui-remote-tmux-probe`, pushed to origin and nowaker-github |
| OpenTUI | `main-nowaker` | `b3bc112c` | `f25ffe29` | native fix, pushed to origin |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Keep the Kitty graphics query out of the tmux pane title over ssh](../features/2026-11-15-remote-tmux-graphics-probe.md) | new | installed title checks below |

## Other delivered work

- OpenTUI fork `main-nowaker` `f25ffe29`: native multiplexer detection before the auto remote return, with a Zig table test (`bun run test:native` 2169/2177, 8 skipped).
- OpenTUI upstream branch `fix/remote-tmux-graphics-probe`, PR body queued in the OpenTUI fork's `.vibeterm/forklog/pr-queue/01-remote-tmux-graphics-probe.md`.

## Verification

- `bun patch --commit` rejects a changed `libopentui.so` ("patches cannot contain binary file changes"), so the fix rides the TypeScript part of the 0.4.5 patch.
- Pre-push typecheck on `dev-nowaker`: 30/30 tasks.
- Title harness: throwaway tmux socket, scratch XDG directories, `-f /dev/null` and `vibeterm.tmux.conf`, reading `#{pane_title}` for up to 60 s.
  - desktop vt-501: `OpenCode` with and without `SSH_CONNECTION` in both configs; the previous binary (vt-499) shows `Gi=31337,s=1,v=1,a=q,t=d,f=24;AAAA` with `SSH_CONNECTION`.
  - m4max vt-502 (tmux 3.8): the same four results; its previous binary leaks the same way.
- `.vibeterm/smoke.sh` on both installed binaries: `SMOKE OK`.

## Build and install

- Build command: `.vibeterm/build.sh` after `bun install --frozen-lockfile` on each host (v1 `build.sh` does not install, so the new patch has to be applied first).
- Installed artifact: desktop `1.19.5-vt-501-006d837c50` from `9973164c6c`; m4max `1.19.5-vt-502-006d837c50` from `14393bb0a1` (`9973164c6c` plus another session's forklog-only commit, same code). v2 migration guard gate passed on both (`@opencode/cli@2.3.0`, `opencode-ai@1.19.5`).
- Running services: not restarted.

## Commit provenance

- `9973164c6c` - patch hunk in `patches/@opentui%2Fcore@0.4.5.patch`
- Required trailer: `AI-Session-ID: ses_e215062b9ffe020IfGlqnRnuPu`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-11-15-remote-tmux-graphics-probe.md
```

## Historical evidence carried forward

- None.

## Unknowns and blocked verification

- The primary checkout's `packages/console/resource/node_modules` was missing until `bun install`, which failed the first pre-push typecheck (`console-app` could not resolve `cloudflare`); worktree runs had hidden it behind turbo cache hits.
