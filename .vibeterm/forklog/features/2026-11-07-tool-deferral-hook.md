# Let a plugin keep tool schemas behind the provider's tool search

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `feat/tool-exposure-hook` (cut from `dev-nowaker`; upstreamable candidate, no PR)
- First local commit: `ac36448956`
- Current local commit(s): `ac36448956`, merge `f8f7cf2e33`
- Upstream base when introduced: `006d837c50` (`v1.19.5`, `github/v1`)
- Last checked against upstream: `006d837c50`

## Original request

> i would generally wan a hybrid. i'd like to define which oc tools are always exposed, and which ones are behind a list.

## Goals

- A `tool.deferral` plugin hook decides, per tool of every request (built-in, plugin, MCP), whether it is sent with `defer_loading`.
- With `@ai-sdk/openai` the Responses `tool_search` tool is added when any tool is deferred.
- Without the hook, requests are byte-identical to before.

## Non-goals

- No search tool for `@ai-sdk/anthropic`: the endpoint brings it (Meridian does). The direct Anthropic API rejects deferred tools without one; the hook doc says to defer only where supported.
- Code mode (`experimentalCodeMode`) returns before the hook and is untouched.

## Rationale and constraints

- Meridian auto-defers every tool but six core ones once a passthrough client sends more than 15 (`MERIDIAN_DEFER_TOOL_THRESHOLD`, upstream #310), and honours a client's own `defer_loading` instead when any tool carries it. Marking tools in opencode gives the user the split.
- `openai.tools.toolSearch()` cannot be used directly: `@ai-sdk/openai` carries a second `@ai-sdk/provider-utils`, so its tool objects do not type as `ai`'s `Tool`. The entry is written in `ai`'s `provider` tool shape with id `openai.tool_search`.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `ac36448956` | 2026-11-07 | `tool.deferral` hook, `deferLoading`, `OPENAI_TOOL_SEARCH` | end of `SessionTools.resolve` in `session/tools.ts`; `Hooks["tool.deferral"]` in `packages/plugin/src/index.ts` |
| `ac36448956` | 2026-11-07 | Tests | `tools.test.ts`: plugin and MCP tool deferred for both providers, OpenAI search added, no hook no change |
| `ac36448956` | 2026-11-07 | Docs | `plugins.mdx` "Tool deferral" |
| `f8f7cf2e33` | 2026-11-07 | Fork merge, no conflicts | - |

## Verification

- `bun test test/session/tools.test.ts`: 8 pass. `bun run typecheck` in `packages/opencode` and `packages/plugin`: clean.
- Run from source with a scratch plugin deferring all but read/write/edit/bash/glob/grep: Claude Haiku through Meridian completed webfetch, Meridian telemetry recorded 10 tools with 4 deferred (below its auto-defer threshold, so the marks were the client's); GPT-5.6 luna through Meridian called `tool_search` then webfetch.
- Same through opencode-tools `toolDeferral.*` settings and the opencode-lazy-mcp-plugin: both providers passed.
- Installed `1.19.5-vt-407-006d837c50` on desktop; v2 guard gate passed.
