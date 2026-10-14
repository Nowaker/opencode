# Hand every clicked ID to plugins

## Identity

- Workday: 2026-10-14
- Session: `ses_ee6a1ab65ffeoR9UKM5RnpfCzC`
- Agent/platform: opencode, `anthropic/claude-opus-5-5` / linux
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `feat/click-any-id`
- Upstream base: `dfb56f76c7` (`v1.19.0`)
- Source result commit(s): `eb6eccb165`
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (2026-10-14):

> `prt_` (message parts) and tool call ids: open ctrl+i at the owning message;
> right click copies only, for every id kind (sch_ included).
> no opencode fork change unless the right click cannot reach the route plugin.
> If so, do it per the fork rules (both remotes, build.sh on desktop and m4max)
> and say so.

## Goals

- A click on any ID Vibeterm can act on reaches Vibeterm's route plugin, not
  only `ses_`/`msg_`.

## Constraints and non-goals

- No right-click handling in opencode: Vibeterm's tmux `MouseDown3Pane`
  binding copies an ID under a right click before opencode sees it.
- Snake_case words (`tool_name`, `trg_state`) must stay plain text.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| opencode fork | `dev-nowaker` | `38e89cabea` | `eb6eccb165` | fast-forward from `feat/click-any-id` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Click controls](../features/2026-10-07-tui-click-controls.md) | extended | `test/ui/id-click.test.ts` |

## Other delivered work

- opencode-tools `feat/click-id-kinds`: the route plugin follows kind `id`
  through the same scanner and actions as Vibeterm's panes.

## Verification

- `bun test test/ui/id-click.test.ts` in `packages/tui` - 8 pass.
- `tsc --noEmit` in `packages/tui` and `packages/plugin` - no errors in the
  changed files (pre-existing errors in `dialog-move-session.tsx` only).
- opencode-tools `opencode-vibeterm-route-plugin/id-click-runtime.test.ts`
  against the built binary on a throwaway tmux socket - pass: own IDs copy,
  another session's `ses_`/`msg_`/`prt_` follow, a right click copies.
- Measured there: the first press opencode receives after a `^i` popup closes
  over its tab never reaches `api.click.on`; the same press a second time does.

## Build and install

- Build command: `.vibeterm/build.sh` through the `opencode-build/build.sh`
  shim, primary checkout with the retry-header cap applied, v2 guard gate
  passed.
- Installed artifact: `1.19.0-vt-300-dfb56f76c7` on desktop and m4max.
- Running services: not restarted; tabs pick it up through `vibeterm_restart_tab`.

## Commit provenance

- `eb6eccb165` - feature.
- Required trailer: `AI-Session-ID: ses_ee6a1ab65ffeoR9UKM5RnpfCzC`

## Unknowns and blocked verification

- Why the first click after a popup closes is dropped: not investigated.
