# Fix three fork-owned test regressions

## Identity

- Workday: 2026-10-11
- Session: `ses_ed2434bbbffelX96qcp5XqFLNw`
- Agent/platform: Sisyphus (`anthropic/claude-opus-5-5`) / linux
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `fork-test-fixes` (worktree); PR head `tui-history-crop` via worktree `history-crop-pr`
- Upstream base: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Source result commit(s): `3ff282aa1d`, `a963ef5224`, `1947fdfb55`
- Forklog commit: this file's introducing commit

## User requests

Assigned by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 32), the user
having approved "Fix them":

> Item 30's v1.19.0 rebase found three test failures in packages/opencode.
> They fail on dev-nowaker, and also on the pre-rebase tip
> `backup/dev-nowaker-pre-v1` (c5ebc3ffd1), but not on plain github/v1. So
> they are regressions from our own fork features

## Goals

- Find the fork commit that owns each failure, fix the feature or (when a
  deliberate fork change made it obsolete) the test, update any upstream PR
  branch, verify, push and install on desktop and m4max.

## Constraints and non-goals

- No assertion weakened to go green; no tab or serve unit restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| opencode fork | `dev-nowaker` | `e785f942b9` | `1947fdfb55` | three fix commits, fast-forward |
| opencode fork | `tui-history-crop` (PR #53660 head, both remotes) | `fd282721f8` | `7661b165d6` | amend with the server fix |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [OpenAI Meridian provider clone](../features/2026-09-27-openai-meridian-provider.md) | fixed in the feature (`3ff282aa1d`) | `llm-native-recorded` "OpenAI OAuth": pass at `dcb7f39d58^`, fail at `dcb7f39d58`, pass with fix |
| [Machine provenance](../features/2026-10-10-machine-provenance.md) | fixed in the feature (`a963ef5224`); one feature test corrected; record created | `session-actions` "expose metadata": pass at `20670c19cd^`, fail at `20670c19cd`, pass with fix |
| [Show and load the messages a long session hides](../features/2026-10-06-tui-history-crop.md) | fixed in the feature (`1947fdfb55`); PR head amended | `httpapi-schema-error-body` "corrupted stored row": pass at `fba21b8d6e^`, fail at `fba21b8d6e`, pass with fix |

Causes:

1. "corrupted stored row" (200 instead of 400): `fba21b8d6e` returned the
   unpaged message list as `HttpServerResponse.jsonUnsafe(...)` to attach
   `X-Total-Count`, bypassing the endpoint's success-schema encode. The
   handler returns the items again and sets the header in a pre-response
   handler on non-error responses.
2. "expose metadata" (PATCH changed nothing): `20670c19cd`'s
   `mergeMetadata` spread the stored metadata over every incoming
   `session.updated` projection at the top level, so stored keys always
   won. It now merges only the `vibeterm` subtree (the only key Vibeterm
   writes behind the engine); `recordExecution` writes the current metadata
   with `vibeterm.lastExecution` replaced. The provenance test that expected
   a non-`vibeterm` key written behind the engine to survive a stale event
   now expects the event's value.
3. "OpenAI OAuth" ("OpenAI API key is missing"): `dcb7f39d58` made the Codex
   OAuth loader bail out for any configured `baseURL`, including OpenAI's own
   default `https://api.openai.com/v1` that the test configures. It now bails
   out only for a non-default (gateway) baseURL, matching
   `gatewayBehaviour()`.

## Verification

- `bun test` of the three targets plus `machine-provenance`, `codex`,
  `session-messages`, `messages-pagination` - 129 pass / 0 fail.
- `bun typecheck` in `packages/opencode`, `packages/schema`, `packages/core` - exit 0.
- Full `packages/opencode` `bun test --timeout 30000`, one after the other
  (load 13-23): fix branch 3796 pass / 36 fail; `dev-nowaker` `234cdf7f62`
  3792 / 39. The failing sets differ by exactly the three targets; nothing
  fails only on the fix branch.
- PR head on `v1`: `bun typecheck` exit 0; `httpapi-schema-error-body`,
  `session-messages`, `messages-pagination` 65 pass / 0 fail.

## Build and install

- Build command: `VIBETERM_V2_GUARD=.../vibeterm-v2-guard .vibeterm/build.sh`
  on each host at `1947fdfb55`; retry patch verified against canonical first.
- desktop: `1.19.0-vt-227-dfb56f76c7`, inode 49968794, v2 guard gate PASSED,
  retry marker present.
- m4max (`~/projects/webapps/opencode`, fast-forwarded): `1.19.0-vt-227-dfb56f76c7`,
  inode 30296642, v2 guard gate PASSED, retry marker present.
- Running services and tabs: not restarted.

## Commit provenance

- `3ff282aa1d`, `a963ef5224`, `1947fdfb55` - fixes on `dev-nowaker`.
- `7661b165d6` - PR #53660 head (no AI trailers).
- Required trailer: `AI-Session-ID: ses_ed2434bbbffelX96qcp5XqFLNw`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-11-fork-test-regressions.md
```

## Historical evidence carried forward

- None.

## Unknowns and blocked verification

- Machine provenance's original prompt and development branch: `TBD`.
- PR #53660 is closed; GitHub keeps its base at `dev`, so only its head
  branch was updated.
