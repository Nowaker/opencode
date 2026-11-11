# Keep tool_search for agents that deny every tool but deferred ones

## Identity

- Workday: 2026-11-10
- Session: [`ses_e38409895ffeKcmQCC8COa4Jok`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e38409895ffeKcmQCC8COa4Jok)
- Agent/platform: opencode / linux (Vibeterm)
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `defer-search-permission`
- Upstream base: `006d837c50` (`v1.19.5`, `github/v1`)
- Source result commit(s): `2c4bd2a36a`, merge `cead509aa0`
- Forklog commit: this file's introducing commit

## User requests

Delegated by coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv):

> OMO subagents running on OpenAI models fail on their first request with APIError `Invalid Value: 'tools.defer_loading'. Deferred tools require tools.tool_search.` The child dies after 0 tool calls.

> The rule to enforce: never send defer_loading tools without the tool_search tool. Either drop deferral for that request or include tool_search.

## Goals

- No GPT request carries a `defer_loading` tool without the hosted `tool_search`.

## Root cause

- `SessionTools.resolve` defers tools through `tool.deferral` and adds `tool_search` (`openai.tool_search`) for `@ai-sdk/openai`.
- `LLMRequestPrep.prepare` then filters tools by the agent's permissions (`resolveTools`, `session/llm/request.ts`). OMO's explore denies `*` and allows read, grep, glob, list, bash, webfetch and websearch, so `tool_search` was stripped while the deferred `webfetch`, `websearch` and `list` kept `defer_loading`. multimodal-looker failed the same way when the parent's `call_omo_agent: true` kept a deferred tool.
- Every explore child on GPT failed from 2026-11-07 (tool deferral switched on): 0 ok since, 93 failures on 11-07..11-10. "Intermittent" was other agents (librarian, oracle) succeeding, not explore.
- Ruled out: lazy-mcp `toolDeferral` (it only answers the hook) and oc-codex-multi-auth (the request already lacked `tool_search` when opencode built it).

## Constraints and non-goals

- Primary checkout's uncommitted retry-header cap (`retry.ts`, `retry.test.ts`) and `.gitignore` left untouched; the build includes the retry cap as usual.
- Merge only; no rebase or force-push.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `018b763108` | `cead509aa0` + forklog | merge `defer-search-permission` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Let a plugin keep tool schemas behind the provider's tool search](../features/2026-11-07-tool-deferral-hook.md) | fixed | `test/session/llm-request.test.ts` |

## Verification

- `env -u TMPDIR bun test test/session/llm-request.test.ts` on the old code: 0 pass, 2 fail (`tool_search` missing beside deferred `webfetch`; `tool_search` left with nothing deferred). With the fix: both pass.
- `tools.test.ts` and `transform.test.ts` pass; `bun typecheck` in `packages/opencode` clean. `llm.test.ts` has 5-6 identity-header/timing timeouts with and without the fix at load average ~50 (pre-existing, not touched).
- Installed binary, `opencode run --agent explore --model openai/gpt-6-luna-fast` in `~/projekty/tmp/vibeterm/opencode-omo-demos`: session `ses_e381e3b64ffeljs0YlGD8tGgZR` answered, one tool call, no error.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh` on each host (the default lookup did not find the guard; the gate ran, not skipped).
- Installed artifact: `1.19.5-vt-436-006d837c50` on desktop (inode 49984166) and m4max; v2 migration guard gate PASSED on both; `.vibeterm/smoke.sh` SMOKE OK on both.
- Running services: not restarted.

## Commit provenance

- `2c4bd2a36a` - fix and regression test
- `cead509aa0` - merge into `dev-nowaker`
- Required trailer: `AI-Session-ID: ses_e38409895ffeKcmQCC8COa4Jok`

## Unknowns and blocked verification

- None.
