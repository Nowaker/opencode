# W1 prompt keyboard selection (W17/W18)

## Identity

- Workday: 2026-11-18
- Session: [`ses_e3832b1b0ffe6q98OeUzhgqhjQ`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3832b1b0ffe6q98OeUzhgqhjQ)
- Agent/platform: `opencode 1.19.5-vt-432-006d837c50`, `anthropic/claude-opus-5-5` / `linux`
- Repository: `Nowaker/opencode` (gitlab `origin`, github `nowaker-github`)
- Integration branch: `dev-nowaker`
- Development branch(es): `selection-boundary-v1` (upstream `v1`, not merged), `selection-boundary-fork`, `w18-pr-entry`
- Upstream base: `006d837c50` (`v1.19.5`) for the fork; `c618499abc` (tree of `v1.19.6`) for the upstream branch
- Source result commit(s): `7c9c67ee2a` (upstream branch), `b08907771b` (fork)
- Forklog commit: this file's introducing commit

## User requests

No human prompt in this session; work came from the v2 coordinator [`ses_e383ee7faffe6JX8m2EP26dXUC`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e383ee7faffe6JX8m2EP26dXUC):

> 1. Commit the 3 files on selection-boundary-v1 (base v1.19.6 = tree of c618499abc; re-fetch github v1 first and say if it moved). [...] Push it to BOTH remotes as a branch only. Do not merge it anywhere.
> 2. Write the W18 pr-queue entry (target branch named, base as above), landed on dev-nowaker on both mirrors. Do NOT file upstream; I'm asking Damian now.
> 3. Freeze the dev-nowaker port as its own packet afterwards [...]

> LAND it on dev-nowaker under the standing re-pin rule [...] Then freeze the desktop v1 build packet. It replaces the live v1 opencode every TUI runs on, so: build+install only (no TUI/service restarts), the v2 guard gate in build.sh must pass, archive the previous binary, protected-identity checks, and a smoke of `opencode --version`.

## Goals

- Shift+arrow in the v1 prompt selects only the crossed cells, upstream branch prepared and fork port installed.

## Constraints and non-goals

- No upstream PR filed (author slot cap full; filing waits for Damian).
- No TUI, tab or service restart; m4max deferred.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `Nowaker/opencode` | `selection-boundary-v1` | (none) | `7c9c67ee2a` | new branch on `c618499abc`, pushed to both mirrors |
| `Nowaker/opencode` | `dev-nowaker` | `d099d3e89c` | `a64022e8a1` | pr-queue entry 14 (`w18-pr-entry`) |
| `Nowaker/opencode` | `dev-nowaker` | `a64022e8a1` | `b08907771b` | fork port (`selection-boundary-fork`) |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Shift+arrow in the prompt selects only the crossed cells](../features/2026-11-18-prompt-keyboard-selection.md) | introduced | fork packet `74f08bd7` |

## Other delivered work

- [pr-queue entry 14](../pr-queue/14-prompt-keyboard-selection.md) (`a64022e8a1`); entry 99's queue-position line names entries 13 and 14.

## Verification

- Upstream branch, packet `w17/packet.json` `3c9bf898` (W15, desktop, 2026-11-19T04:16Z): empty-subclass mutant red at "first ShiftLeft selects only the crossed cell", keeper 1/0, tui suites 22/0, opencode `test/cli/tui` 67/0, `bun turbo typecheck` 30/30.
- Fork port, packet `w17/fork-packet.json` `74f08bd7` (W15, desktop, 2026-11-19T04:44Z): both mutants red as named (empty subclass; old instant editor), keeper 1/0, `test/instant/` 41/0, tui suites 423/0, opencode `test/cli/tui` 70/0, turbo 30/30.
- A full-app keeper was retired: it focused a dialog's input instead of the prompt and once rendered a blank frame (35 empty rows, no error logged); the direct-mount keeper replaced it.
- Manual surface: none; no live TUI was driven.

## Build and install

- Build command: `.vibeterm/build.sh` (v1), packet `w17-build/packet.json` `2801fd45`, unit `w1-w17-desktop-b089077`.
- Installed artifact: desktop `bin/opencode` `1.19.5-vt-556-006d837c50`, sha256 `1c6273caeb2419e5...`; retry-cap and v1 guard gates passed; vt-554 archived as `opencode.prev-1795064294` (coordinator verified 2026-11-19T05:00Z).
- Running services: opencode2 and the system and user `opencode-serve-*` identities compared unchanged before/after; nothing restarted.

## Commit provenance

- `7c9c67ee2a` - upstream `v1` branch commit.
- `a64022e8a1` - pr-queue entry 14.
- `b08907771b` - fork port.
- Required trailer: `AI-Session-ID: ses_e3832b1b0ffe6q98OeUzhgqhjQ`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-11-18-prompt-keyboard-selection.md
```

## Historical evidence carried forward

- None.

## Unknowns and blocked verification

- The original shift+left report that opened W17 is not in this session's retained history: TBD.
- Upstream filing: waits for Damian's say-so and a free author slot.
- m4max install: deferred while m4max travels.
