# Park no-routable-account refusals as a session pause

## Identity

- Workday: 2026-11-16
- Session: [`ses_e19b13eecffe6sjiKlzQOQXiNl`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e19b13eecffe6sjiKlzQOQXiNl)
- Agent/platform: opencode (anthropic/claude-opus-5-5) / darwin (m4max)
- Repository: `~/projects/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `park-no-routable` (managed worktree)
- Upstream base: `006d837c50` (upstream `v1`, `v1.19.5`)
- Source result commit(s): `54423dac1b`
- Forklog commit: this file's introducing commit

## User requests

From coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv):

> 1. An error with that code or prefix, in the recorded body or the message, must not end the turn. Park it: pause the session at that step using the fork's existing pause feature (SessionPause; /pause, vibeterm_pause_turn), with the error text as the pause reason, so the TUI shows PAUSED and the reason.
> 2. On unpause, retry the SAME model step: the same request, no resubmit of the user prompt. Drop any partial output from the failed stream. Every other error behaves exactly as today. Keep it resumable across a restart of the tab if the pause feature already persists.
> 3. Work test-first, with a scripted provider that refuses both before the stream and inside it, plus cases showing other errors are unchanged. Also run a real isolated opencode on a throwaway tmux socket against a scripted HTTP endpoint that emits both shapes, and capture the pane.
> 4. Build only on m4max [...] Push dev-nowaker to origin AND nowaker-github. Install on m4max. Do NOT install on desktop yet.

Contract amendments from the Meridian coordinator [`ses_fe8a27c6effe6KEx3TRNvOLgUo`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_fe8a27c6effe6KEx3TRNvOLgUo): the refusal message ends with ` (incident inc_<epochMs>_<seq>)` in both shapes, because the in-stream path strips every field but the message (found by this session).

## Goals

- See the [feature record](../features/2026-11-16-park-no-routable-account.md).

## Constraints and non-goals

- No other retry behavior changes; no restart of other sessions' tabs; no Meridian code.
- m4max only for builds, tests and installs; desktop install deferred to the coordinator.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| opencode | `dev-nowaker` | `cd6a380153` | `54423dac1b` | fast-forward of `park-no-routable` via `vibeterm_worktree_land`; pushed to origin and nowaker-github (`git@github.com:Nowaker/opencode.git`) |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Park no-routable-account refusals](../features/2026-11-16-park-no-routable-account.md) | new | `54423dac1b`; tests and tmux e2e below |
| [Session pause](../features/2026-11-14-session-pause.md) | extended (`Info.error`, parked notice text) | pause.test.ts 41 pass |

## Other delivered work

- Answered part D [`ses_e19abd614ffex9gg5nxDazGj6L`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e19abd614ffex9gg5nxDazGj6L) on the park's shape: reason verbatim with the incident token, `source.client = "no_routable_account"`, plain unpause rebuilds the same request, and a prompt with `unpause: true` runs as the next step (the parked step is dropped, not queued).

## Verification

- Red first: both park tests failed on the unchanged source (2 step requests: the refusal was retried).
- `bun test test/session/pause.test.ts test/session/pause-refusal.test.ts` - 41 pass, 0 fail.
- Eleven session/server suites - 389 pass, 2 skip, 1 fail; the failure (`unarchive records the tui actor ...`, 5s timeout) also fails on base `cd6a380153`.
- `bun typecheck` clean in opencode, tui, sdk/js, client; generators idempotent.
- tmux e2e (socket `park-e2e`, scripted Anthropic endpoint): pre-stream park, in-stream park with partial text dropped, park survives TUI restart, final unpause recovers; identical `messages` in all three turn requests. Evidence in `.vibeterm/tmp/park-e2e-evidence/`.
- The worktree's first `bun install` failed on the `tree-sitter-powershell` install script and broke bash tools in tests; `bun install --frozen-lockfile --ignore-scripts` fixed it.

## Build and install

- m4max: not built. Available memory stayed at 7.5-20 GB from 23:15Z to 01:23Z, under the 30 GB gate. At 01:18Z coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv) moved the first build to desktop.
- Installed artifact (m4max): not built by this session. m4max runs `1.19.5-vt-521-006d837c50` (inode 107234381, 21:17 CST), built from `dev-nowaker` `f171dd4d50` (which contains `54423dac1b`) by session [`ses_e1d8f706fffe`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e1d8f706fffe) (full id TBD). The binary contains `No routable Claude account` and `no_routable_account`. `.vibeterm/smoke.sh <installed binary>` - SMOKE OK (2026-11-17 03:4xZ).
- m4max finding: vt-521 and the archived vt-517 lack the retry-cap marker `OPENCODE_RETRY_MAX_HEADER_DELAY_MS`, while archived vt-514 and vt-511 contain it, so the m4max builds since vt-517 were made without `retry-header-delay-cap.patch`. Reported to the coordinator; not rebuilt here.
- desktop: detached worktree `.vibeterm/worktrees/park-no-routable-build` at `54423dac1b` with the canonical `retry-header-delay-cap.patch` applied (the primary checkout's dirty retry diff reverse-applied cleanly against it). Gate checked right before start: MemAvailable 52 GB. `bun install --frozen-lockfile` (2334 packages, ok), then `OPENCODE_SRC=<worktree> .vibeterm/build.sh` under `systemd-run --user --unit=opencode-build-park-no-routable`. Log: desktop `.vibeterm/tmp/build-park-no-routable-desktop.log`.
- Installed artifact (desktop): `1.19.5-vt-518-006d837c50`, `/home/nowaker/projekty/webapps/opencode-build/bin/opencode`, inode 49951435 (previous `vt-517` archived as `opencode.prev-1794878626`). v2 migration guard gate PASSED (2026-11-17T01:23:34Z). Binary contains the retry marker `OPENCODE_RETRY_MAX_HEADER_DELAY_MS` and the strings `No routable Claude account` and `no_routable_account`.
- Smoke: the chained `smoke.sh` call lacked its binary argument and failed with `$1: unbound variable`; rerun as `.vibeterm/smoke.sh <installed binary>` - SMOKE OK.
- Running services: no tab or service restarted; `opencode-serve-tailscale.service` is a disabled reference unit. The worktree was removed after the build.

## Commit provenance

- `54423dac1b` - feat(session): park no-routable-account refusals as a pause
- Required trailer: `AI-Session-ID: ses_e19b13eecffe6sjiKlzQOQXiNl`

## Unknowns and blocked verification

- Joint end-to-end with Meridian (hop, exhaust, park, unpause) waits on the install. Per the Meridian coordinator (2026-11-16 23:26Z), Meridian `ec674e39` is live on m4max @dev but stays in plain active mode until [`qst_1e64c2011001S8YpL36hs018aq`](https://portal.vibeterm.desktop.ts.nowaker.net/question/qst_1e64c2011001S8YpL36hs018aq) is answered, so the joint run uses a scratch Meridian from worktree `ec674e39` in active+priority mode on a loopback port.
- Meridian's built refusal also carries `retry_after` (seconds). The park doesn't copy it into `pause.error`, but the full pre-stream body stays in `pause.error.api_error`.
