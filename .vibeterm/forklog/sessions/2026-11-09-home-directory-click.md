# Home footer directory click hook

## Identity

- Workday: 2026-11-09
- Session: `ses_e3d8a6cc6ffegC1MnjWnwibwHN`
- Agent/platform: opencode / linux (Vibeterm)
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `feat/home-directory-click`
- Upstream base: `006d837c50` (`v1.19.5`)
- Source result commit(s): `56d05e171b`, merge `b8933da0d6`
- Forklog commit: this file's introducing commit

## User requests

> in opencode new session prompt, as well as in vt prompt draft, allow a click on the project directory, and to open directory finder/switcher, to switch to a different project.

## Goals

- The fork adds only a generic hook; the project list, ranking and the move live in opencode-tools (`_lib/project-finder`, route plugin `project-switch.ts`).

## Constraints and non-goals

- The main checkout's uncommitted retry-header cap (`retry.ts`, `retry.test.ts`) and `.gitignore` edit were preserved; the builds ran from the main checkouts, so vt-413 carries the cap (`RETRY_MAX_HEADER_DELAY_MS` present in the binary).

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `011376c894` | `b8933da0d6` + forklog | merge `feat/home-directory-click` |

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh`.
- Installed artifact: `1.19.5-vt-413-006d837c50` on both hosts; desktop inode `49982208`, m4max inode `56208297` (after `bun install --frozen-lockfile`); v2 guard gate passed and `.vibeterm/smoke.sh` SMOKE OK on both.

## Features touched

- [Let a plugin take a click on the home footer's directory](../features/2026-11-09-home-directory-click.md)
