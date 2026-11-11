# Publish a background bash command's Started before its Exited

## Identity

- Workday: 2026-11-11
- Session: [`ses_e3b66e073ffeBjngD0B2e6LCl8`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3b66e073ffeBjngD0B2e6LCl8)
- Agent/platform: `Sisyphus - ultraworker` (`anthropic/claude-opus-5-5`, high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `feat/bash-background`
- Upstream base: `006d837c50` (`v1.19.5`, `github/v1`)
- Source result commit(s): `081451095b`, merge `34bccf2103`
- Forklog commit: this file's introducing commit

## User requests

From coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv), approved by Damian in [`qst_1cb80948a0014HddKVpMEnenR5`](https://portal.vibeterm.desktop.ts.nowaker.net/question/qst_1cb80948a0014HddKVpMEnenR5), reported by the memory hunt [`ses_e35186c88ffekOriWq81n4UFM5`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e35186c88ffekOriWq81n4UFM5): OMO's running-jobs ledger on desktop listed 11 bash jobs in 9 sessions, 169-1028 min old and not running, so the idle parker never parked those tabs (1.1-1.5 GB each). "fork: Started is always published before Exited for the same id".

## Goals

- A listener never sees `shell.background.exited` before `shell.background.started` for the same job.

## Constraints and non-goals

- No change to the events' shape or to when Started is published.
- OMO's defence against an out-of-order pair lands on the OMO fork (`a04750a647`, `63bd0858cf`, merge `458af13a8f`).
- Keep the uncommitted retry-header cap in both main checkouts.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `feat/bash-background` | `2e8e50f138` | `081451095b` | commit |
| `opencode` | `dev-nowaker` | `5288531c0b` | `34bccf2103` | merge |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Run bash commands in the background and move a timed-out one there](../features/2026-11-10-bash-background.md) | changed | `shell-background.test.ts` red/green below |

## Other delivered work

- OMO fork, same session: `BashBackgroundManager` drops a Started whose Exited came first and stops listing a record past its `timeoutMs` plus 5 min; `listAll()` (the ledger source) prunes the same way.

## Verification

- Cause: `started()` awaited `outputFile()` (a file write) before publishing Started, while `background.start` (`run_in_background`) or `promote` (a foreground timeout) had already marked the job background; `publishExited` checked only that mark. Every stale ledger job's output file was last written at or before its ledger `startedAt`.
- `bun test test/tool/shell-background.test.ts` with `Truncate.write` wrapped to take 3 s, for `run_in_background` (`exit 0`) and a foreground timeout (`sleep 1.5; exit 0`, timeout 300): red without the fix, both `["exited", "started"]`, 0 pass 2 fail; green 9 pass 0 fail, three runs in a row, and on the merge.
- `bun run typecheck` in `packages/opencode`: clean on the branch and the merge.
- The pre-push hook's `bun turbo typecheck` failed in the main checkout (`packages/protocol` and `packages/server` cannot resolve `@opencode-ai/schema/*` and `effect`; unrelated to this change), so both pushes went from the merge worktree, where it passed.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh` from each main checkout at `34bccf2103`, with the uncommitted retry-header cap in place.
- Installed artifact: `1.19.5-vt-459-006d837c50` on desktop (inode 49950387) and m4max (inode 61087460); v2 guard gate PASSED on both; `.vibeterm/smoke.sh <binary>` SMOKE OK on both.
- Running services were not restarted.

## Commit provenance

- `081451095b` - fix; `34bccf2103` - merge.
- Required trailer: `AI-Session-ID: ses_e3b66e073ffeBjngD0B2e6LCl8`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-11-11-bash-event-order.md
```

## Historical evidence carried forward

- None.

## Unknowns and blocked verification

- The race was not reproduced live; the test widens it with a 3 s output-file write.
- Running TUIs keep the old binary until restarted.
