# PAUSED and INBOX badges on held deliveries

## Identity

- Workday: 2026-11-16
- Session: [`ses_e1ace8d28ffeR2WGjY311j34E8`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e1ace8d28ffeR2WGjY311j34E8)
- Agent/platform: `Sisyphus - ultraworker` (anthropic/claude-opus-5-5, high) / linux on desktop
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `held-delivery-badges` (managed worktree, cut from `dev-nowaker` `861d59c594`)
- Upstream base: `006d837c50` (`v1.19.5`)
- Source result commit(s): `f2cd6fe8e3`
- Forklog commit: this file's introducing commit

## User requests

Spawned by coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv):

> Damian's request, 2026-11-16 ~16:15Z: the TUI does not show that messages are held behind /pause. [...] He wants the same kind of badge as the TUI's existing QUEUED, but reading PAUSED while the session is paused.

The full label contract (QUEUED, PAUSED, INBOX, "INBOX - wakes HH:MM") is quoted in the [feature record](../features/2026-11-16-held-delivery-badges.md#original-request).

## Goals

- QUEUED / PAUSED / INBOX badges on unread user messages, each word in one constant.

## Constraints and non-goals

- Display only: no delivery, hold or wake behavior changes. No restarts of other sessions' tabs. Leave the primary's dirty `.gitignore`, `retry.ts`, `retry.test.ts` alone. One build per host, memory gate before each.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `861d59c594` | `f2cd6fe8e3` | `held-delivery-badges` landed (fast-forward), pushed to `origin` and `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [PAUSED and INBOX badges on held deliveries](../features/2026-11-16-held-delivery-badges.md) | new | tests and QA below |
| [Choose when a running turn reads queued prompts](../features/2026-11-10-queued-prompt-timing.md) | changed: its QUEUED badge now comes from `DeliveryLabel`, and the "Unqueue" action also covers a prompt held by a pause during a run | `prompt-delivery.test.ts` existing cases unchanged and green |
| [Pause a session after its current step and unpause it later](../features/2026-11-14-session-pause.md) | changed: held prompts read PAUSED | QA below |

## Other delivered work

- Scratch QA script `opencode-tools/tmp/held-badges-qa.ts` (ignored scratch, not committed) and demo script `~/projekty/tmp/vibeterm/opencode-omo-demos/held-delivery-badges/demo.sh` with its pane captures.

## Verification

- `bun test test/routes/session/prompt-delivery.test.ts` (packages/tui) - 13 pass; the 7 new cases failed first (missing export).
- `bun typecheck` (packages/tui) - clean. `bun test` (packages/tui) - 898 pass, 1 skip, 0 fail.
- Manual surface, isolated: `held-badges-qa.ts` on scratch vt-514 - all five stages pass (QUEUED; PAUSED; PAUSED x2 + INBOX x2 without time; no badge after unpause; idle INBOX + "INBOX - wakes 12:00 PM", matching `wake_due` 18:00:55Z).
- Manual surface, live demo [`ses_e1a84831fffe3CPwTayDoxGKHu`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e1a84831fffe3CPwTayDoxGKHu) on installed vt-514: QUEUED, PAUSED, PAUSED + INBOX x2, then one turn answered all of them and no badge remained.
- Observed, not this change: with desktop's `legacy` delivery method, a wake=never/later note to a running or idle, unpaused session is written as a row the TUI does not show until reload (installed vt-512 behaves the same); with `VIBETERM_DELIVERY_METHOD=socket` it appears live. And a wake=never/later note to a paused tab over control reported "delivery acceptance is uncertain: ... timed out" twice in the demo although both notes were stored. Both are opencode-tools follow-ups.

## Build and install

- Scratch: `OPENCODE_SRC=<worktree> OPENCODE_INSTALL=<worktree>/tmp/bin/opencode .vibeterm/build.sh` under `systemd-run --user` - `1.19.5-vt-514-006d837c50`, guard gate PASSED, `smoke.sh` SMOKE OK. The first attempt failed with `vite: command not found` until `bun install --frozen-lockfile` completed in the worktree.
- desktop: `.vibeterm/build.sh` from the primary checkout under `systemd-run --user` - installed `1.19.5-vt-514-006d837c50` (inode 49952476, 11:41 local), guard gate PASSED, retry marker present, SMOKE OK.
- m4max: `.vibeterm/build.sh` over ssh (PATH needs `~/.bun/bin`) - installed `1.19.5-vt-514-006d837c50`, guard gate PASSED, retry marker present, SMOKE OK.
- Running services: not restarted.

## Commit provenance

- `f2cd6fe8e3` - feat(tui): badge prompts held by a pause and notes that start no turn
- Required trailer: `AI-Session-ID: ses_e1ace8d28ffeR2WGjY311j34E8`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-11-16-held-delivery-badges.md
```

## Historical evidence carried forward

- None.

## Unknowns and blocked verification

- The INBOX word is pending the user's choice through the coordinator.
