# Keep the Kitty graphics query out of the tmux pane title over ssh

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `fix/opentui-remote-tmux-probe` (opencode); OpenTUI source `main-nowaker` `f25ffe29` and upstream branch `fix/remote-tmux-graphics-probe` on github.com/Nowaker/opentui
- First local commit: `9973164c6c`
- Current local commit(s): `9973164c6c`
- Upstream base when introduced: `41ef5eda50` (`dev-nowaker`, upstream `v1.19.5`)
- Last checked against upstream: `v1.19.5`

## Original request

From coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv), on a defect found by [`ses_e2562f980ffe48VSWDL6KYVPBb`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e2562f980ffe48VSWDL6KYVPBb):

> Multiplexer detection (TMUX, ZELLIJ*, STY, TERM tmux*/screen*) describes the local pane and must run regardless of the remote early return. Keep the remote early return for the endpoint-identity keys it exists to skip

## Goals

- opencode started in a tmux pane whose environment carries `SSH_CONNECTION`, `SSH_CLIENT`, `SSH_TTY` or `MOSH_CONNECTION` (a tmux server started from an ssh login) keeps the pane title it had, instead of `Gi=31337,s=1,v=1,a=q,t=d,f=24;AAAA`.

## Non-goals

- No change outside ssh/mosh sessions, and none when a caller passes `remote` or `forwardEnvKeys`.
- The endpoint identity keys (`TERM_PROGRAM`, `OPENTUI_*`, notification heuristics) stay ignored in auto remote mode.

## Rationale and constraints

- `@opentui/core` 0.4.5 native detection ignores the process environment once it sees an ssh login, so `TMUX` never marks the pane as tmux. The Kitty graphics query goes out after the first capability reply. Behind the instant prompt that reply is not tmux's XTVERSION, so the query is unwrapped and tmux sets it as the pane title.
- The real fix is native (OpenTUI `f25ffe29`), and `bun patch` refuses binary changes, so the 0.4.5 patch forwards the multiplexer keys through the renderer's existing `forwardEnvKeys` path. Native then sees only those keys, and remote mode stays on through its earlier process-environment read.
- v2 (`opencode2`, OpenTUI 0.8.1) does not leak and needs no change.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `9973164c6c` | 2026-11-15 | In an ssh/mosh session with auto remote mode, forward `TMUX`, `ZELLIJ*`, `STY` and a tmux/screen `TERM` to native detection | `patches/@opentui%2Fcore@0.4.5.patch` (`CliRenderer` constructor, `forwardEnvKeys`) |

## Verification

- Throwaway tmux 3.7c sockets with `-f /dev/null` and `vibeterm.tmux.conf`, opencode started through `packages/opencode/src/boot.ts` with scratch XDG directories: with `SSH_CONNECTION` the unpatched package sets the title to `Gi=31337,...` in both configs and the patched one keeps `OpenCode`; without it both keep `OpenCode`. `src/index.ts` (no instant prompt) does not reproduce the leak.
- `createCliRenderer` capabilities with the patch: `remote: true, multiplexer: tmux` under ssh, `remote: false, multiplexer: tmux` without.
- Installed binaries: see the [session record](../sessions/2026-11-15-remote-tmux-graphics-probe.md).

## Timeline

- 2026-11-15 [`ses_e215062b9ffe020IfGlqnRnuPu`](../sessions/2026-11-15-remote-tmux-graphics-probe.md) - initial build, landed on `dev-nowaker`, built and installed on desktop and m4max. Evidence: linked session record.

## Current maintenance notes

- An `@opentui/core` bump drops this patch hunk once the release contains the native fix (upstream PR from `fix/remote-tmux-graphics-probe`). Check that a tmux pane started with `SSH_CONNECTION` keeps its title on the new release before dropping it.
