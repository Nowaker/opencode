# Send a held prompt after the turn it waited behind

## Identity

- Workday: 2026-11-10 (America/Chicago)
- Session: [`ses_e37b26ea1ffeyDu2wQLAdY0TmV`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e37b26ea1ffeyDu2wQLAdY0TmV)
- Agent/platform: opencode / linux (Vibeterm)
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `mid-turn-delivery` (the feature's own branch, at `68e4a9e291`)
- Upstream base: `006d837c50` (`v1.19.5`, `github/v1`)
- Source result commit(s): `ed9e8785a9`, merge `85466d15f4`
- Forklog commit: this file's introducing commit

## User requests

Delegated by coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv), found by `[mid-turn-api]` `ses_e383bbdb6ffe`:

> queued_prompts "turn_end": a vt-notify-session note sent mid-turn is held until the turn ends, which is correct. But the follow-up turn it triggers sees the note as EMPTY.

## Root cause

- Repro: `ses_e38230363ffembVLHApoqI4t0p`, note `msg_1c8508d7c001` (`TURNEND-NOTE-1`, 383 chars stored intact) at 01:54:44Z; the follow-up answer `msg_1c851ee5c001` said the latest message "arrived empty".
- `holdForTurnEnd` (`packages/opencode/src/session/prompt.ts`) correctly hides the note until the turn ends. The follow-up loop then sends history in stored order, so the note sits between the turn's tool steps and the request ends with the turn's own final assistant answer. The model saw no user input after its last answer.
- The existing turn_end test only checked that the third request contained the held text, not where.

## Fix

- `answerAfterTurn`, applied only under `turn_end` after `holdForTurnEnd`: once the newest assistant step has finished on stop, every user message stored after the prompt it answered and placed before that step moves to just after it, in stored order. Model input only; history and parent IDs are unchanged.

## Constraints and non-goals

- Primary checkout's uncommitted retry-header cap (`retry.ts`, `retry.test.ts`) and `.gitignore` left untouched; the build includes the retry cap as usual.
- Merge only; no rebase or force-push.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `mid-turn-delivery` | `68e4a9e291` | `ed9e8785a9` | fix |
| `opencode` | `dev-nowaker` | `8f1bd53e76` | `85466d15f4` + forklog | merge `mid-turn-delivery` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Choose when a running turn reads queued prompts](../features/2026-11-10-queued-prompt-timing.md) | fixed | `test/session/prompt.test.ts` turn_end tests |

## Verification

- `bun test test/session/prompt.test.ts -t turn_end` in `packages/opencode`: 4 pass with the fix; with `prompt.ts` reverted, both ordering tests fail (the strengthened prompt test and the new noReply note test).
- `prompt`, `async-snapshot`, `runner` suites on the merged tree (`--timeout 60000`, load ~40): 138 pass, 0 fail. At the 5 s default three async-snapshot/compaction tests time out under load; all 65 pass at 60 s.
- `tsc --noEmit` in `packages/opencode`: 11 errors, all in `packages/tui/src/component/dialog-move-session.tsx`, untouched here.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh`.
- Installed artifact: `1.19.5-vt-449-006d837c50` on desktop (inode 49972367); v2 migration guard gate PASSED; `.vibeterm/smoke.sh` SMOKE OK; the binary has one more `["tool-calls","unknown"].includes` than the previous one (6 vs 5), the new check.
- m4max: see the session's later commit.
- Running services: not restarted.

## Commit provenance

- `ed9e8785a9` - fix and regression tests
- `85466d15f4` - merge into `dev-nowaker`
- Required trailer: `AI-Session-ID: ses_e37b26ea1ffeyDu2wQLAdY0TmV`
