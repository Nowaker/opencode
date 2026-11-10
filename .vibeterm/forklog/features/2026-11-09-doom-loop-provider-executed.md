# Skip the doom_loop ask for provider-executed tool calls

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `doom-loop-hosted` (cut from `dev-nowaker`); upstreamable twin `doom-loop-upstream` on `github/v1` (`a9e993aeee`, pushed to `nowaker-github`, PR not opened)
- First local commit: `beb7eba846`
- Current local commit(s): `beb7eba846`, merge `5a845affb9`
- Upstream base when introduced: `006d837c50` (`v1.19.5`, `github/v1`)
- Last checked against upstream: `006d837c50`

## Original request

Coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv), relaying the user:

> Fix a false permission prompt the user hit on m4max. They never want permission approvals for tool calls.

## Goals

- Provider-executed tool calls (part `metadata.providerExecuted`, e.g. OpenAI's hosted `tool_search`) never raise a `doom_loop` ask.
- Three identical client-executed calls still raise it.

## Non-goals

- The `doom_loop` permission default is unchanged; the coordinator asks the user about it separately.

## Rationale and constraints

- m4max 2026-11-09T23:45:04Z, `per_1c2b37a9e001O23qNX5C1yBAya`: session `ses_e3d4f35d0ffelTCTCr5vTYdTK0`, message `msg_1c2b36900001z7XN6x5g8ZmazQ`, held three consecutive `tool_search` parts with identical input `{"arguments":{"paths":["perplexity_perplexity_ask"]},"call_id":null}`, all `providerExecuted: true`. The model genuinely repeated the same load; the input is the real query, not an empty placeholder.
- The provider runs these calls before opencode sees the `tool-call` event, so an ask can neither stop nor change them. The exposure came with the [`tool.deferral` hook](./2026-11-07-tool-deferral-hook.md), which adds `tool_search` for `@ai-sdk/openai`; the guard itself is upstream code and applies to every hosted tool.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `beb7eba846` | 2026-11-09 | Return before the doom-loop check when the updated tool part is `providerExecuted` | `case "tool-call"` in `SessionProcessor` (`session/processor.ts`), the `updateToolCall` result |
| `beb7eba846` | 2026-11-09 | Tests | `processor-effect.test.ts`: "skip doom_loop for repeated provider-executed calls", "ask doom_loop for repeated identical client calls" |
| `5a845affb9` | 2026-11-09 | Fork merge, no conflicts | - |

## Verification

- `bun run test test/session/processor-effect.test.ts` in the worktree: 19 pass. With only `processor.ts` restored to `acb585ab55`: the provider-executed test fails (`[]` expected, `["doom_loop"]` received), the client test passes.
- `bun typecheck` in `packages/opencode`: clean. Push hook on `5a845affb9`: 30/30 typecheck tasks.
- Same patch on `github/v1` (`a9e993aeee`): 19 pass, typecheck clean.
- Installed `1.19.5-vt-410-006d837c50` on desktop and m4max; v2 guard gate passed and `.vibeterm/smoke.sh` OK on both.

## Timeline

- 2026-11-09 [`ses_e3d3aa52effeG1KLcRHIKZ6FDU`](../sessions/2026-11-09-doom-loop-provider-executed.md) - initial build. Evidence: `beb7eba846`, merge `5a845affb9`, vt-410 on both hosts.
- 2026-11-10 [`ses_e3b76f3eaffe6Ydg2S8MTeZa64`](../sessions/2026-11-10-permission-defer-reply.md) - re-verified: the same block now also catches a deferred ask after the provider-executed return. Evidence: `processor-effect.test.ts` on `8940e84418`.

## Current maintenance notes

- Upstream PR body draft: `.vibeterm/tmp/opencode/pr-body-doom-loop-provider-executed.md` (untracked). Once the upstream fix lands, drop this customization in the next bump.
