# doom_loop ask on provider-executed tool_search

## Identity

- Workday: 2026-11-09
- Session: [`ses_e3d3aa52effeG1KLcRHIKZ6FDU`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3d3aa52effeG1KLcRHIKZ6FDU)
- Agent/platform: opencode / linux (Vibeterm)
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `doom-loop-hosted`; upstream twin `doom-loop-upstream`
- Upstream base: `006d837c50` (`v1.19.5`)
- Source result commit(s): `beb7eba846`, merge `5a845affb9`; upstream twin `a9e993aeee`
- Forklog commit: this file's introducing commit

## User requests

From coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv):

> Fix a false permission prompt the user hit on m4max. They never want permission approvals for tool calls.

## Goals

- The doom-loop guard ignores provider-executed tool calls; a test fails on the old code.

## Constraints and non-goals

- The `doom_loop` permission default is unchanged.
- The main checkout's uncommitted retry-header cap (`retry.ts`, `retry.test.ts`) and `.gitignore` edit were preserved; both builds ran from the main checkouts, so vt-410 carries the cap.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `acb585ab55` | `5a845affb9` + forklog | merge `doom-loop-hosted` |
| `opencode` | `doom-loop-upstream` | - | `a9e993aeee` | new branch on `github/v1`, pushed to `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Skip the doom_loop ask for provider-executed tool calls](../features/2026-11-09-doom-loop-provider-executed.md) | added | processor-effect tests, red on the old code |

## Verification

- Cause confirmed from m4max `opencode.db` by session ID only: three identical provider-executed `tool_search` parts in `msg_1c2b36900001z7XN6x5g8ZmazQ` of `ses_e3d4f35d0ffelTCTCr5vTYdTK0` preceded `per_1c2b37a9e001O23qNX5C1yBAya`. The recorded input is the model's real query; no change to recording was needed.
- `bun run test test/session/processor-effect.test.ts`: 19 pass; the new provider-executed test fails on `acb585ab55`'s `processor.ts`.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh` on desktop and m4max (m4max after `bun install --frozen-lockfile`).
- Installed artifact: `1.19.5-vt-410-006d837c50` on both hosts; desktop inode `49983382`, m4max inode `56204741`; retry marker present; `.vibeterm/smoke.sh` SMOKE OK on both.
- Running services: not restarted.

## Commit provenance

- `beb7eba846` - fix; `5a845affb9` - merge.
- Required trailer: `AI-Session-ID: ses_e3d3aa52effeG1KLcRHIKZ6FDU`

## Unknowns and blocked verification

- The coordinator reported two asks; the current m4max `opencode.log` holds one. The other is presumably in a rotated log; not searched.
