# Let a fork copy only the context, and count a copy's usage once

## Identity

- Workday: 2026-11-11
- Session: [`ses_e3b66e073ffeBjngD0B2e6LCl8`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3b66e073ffeBjngD0B2e6LCl8)
- Agent/platform: `Sisyphus - ultraworker` (`anthropic/claude-opus-5-5`, high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`, plus `~/projekty/forks/oh-my-openagent`
- Integration branch: `dev-nowaker`
- Development branch(es): `feat/fork-as-child`
- Upstream base: `006d837c50` (`v1.19.5`, `github/v1`)
- Source result commit(s): `d6ec184270`, merge `13f8d45412`; OMO `a3ebac374c` (`feat/cc-tools-step6`)
- Forklog commit: this file's introducing commit

## User requests

From coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv), the fork items of the package's bug list: "copy only from the parent's latest compaction summary forward, keeping unsettled exclude" and "Fork copies keep cost and tokens. Zero them, or mark them so cost readers skip them."

## Goals

- A fork subagent starts with the context its parent's next turn reads, not a long session's whole transcript.
- A fork's copied messages add no cost or tokens anywhere.

## Constraints and non-goals

- The TUI background forks and the Vibeterm fork tool keep the full copy (`history` defaults to "all").
- Forks already in the database keep their copied cost; nothing rewrites history.
- Keep the uncommitted retry-header cap in both main checkouts.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `feat/fork-as-child` | `db917f0795` | `d6ec184270` | commit |
| `opencode` | `dev-nowaker` | `c7c2ea69a5` | `13f8d45412` | merge |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Let a session fork be a child of another session](../features/2026-11-10-fork-as-child.md) | changed | `test/session/fork.test.ts` red/green below |

## Other delivered work

- OMO `feat/cc-tools-step6` `a3ebac374c`: the fork subagent asks for `history: "context"`, reports only the child's own answer (an answer-less fork reports ERROR with its resume line), and sends one notice per task run.

## Verification

- Cause, from the coordinator's demo: a fork copied 2,658 of a 6,459-message session in 4 minutes and the copies showed $618.54 and 2.83M output tokens without one request.
- `bun test test/session/fork.test.ts` - red 6 pass 3 fail (the context copies kept the pre-compaction exchange; a copied answer kept $0.25); green 25/0 with `fork-lineage` and `machine-provenance`.
- `test/server/httpapi-session.test.ts`, `test/server/session-actions.test.ts`, `test/session/session.test.ts` - 38/0; `bun run typecheck` and the SDK's `tsc --noEmit` clean. On the merge: fork, lineage, httpapi-session and shell-background 47/0, typecheck clean.
- Live, isolated (OMO step 6 harness `run-fork2.sh`, this branch's server from source, scratch XDG + HOME, fake LLM): the fork child's copied answer has tokens 0/0 and a step-finish of 0/0, its own answer 10/5; sandbox session rows in the real DB 0; no server left.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh` from each main checkout at `13f8d45412`, with the uncommitted retry-header cap in place.
- Installed artifact: `1.19.5-vt-452-006d837c50` on desktop (inode 49972662) and m4max (inode 56860262); v2 guard gate PASSED on both; `.vibeterm/smoke.sh <binary>` SMOKE OK on both.
- The first push of `13f8d45412` exited 141 after the pre-push typecheck passed and sent nothing; the same push repeated went through to both remotes.
- Running services were not restarted.

## Commit provenance

- `d6ec184270` - fix; `13f8d45412` - merge.
- Required trailer: `AI-Session-ID: ses_e3b66e073ffeBjngD0B2e6LCl8`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-11-11-fork-context.md
```

## Historical evidence carried forward

- None.

## Unknowns and blocked verification

- A compacted parent was not forked live; the server tests cover it, with and without a kept tail.
- This session's second forklog commit of the workday: the first (`cfeb4393e8`, bash exit duration) was already pushed.
