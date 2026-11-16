# Let a plugin keep tool schemas behind the provider's tool search

## Identity

- Status: active
- Integration branches: `dev-nowaker` (v1 source and all forklog records), `v2-nowaker` (native v2 source)
- Development branch(es): `feat/tool-exposure-hook` (cut from `dev-nowaker`; upstreamable candidate, no PR), `deferred-tool-catalog`
- First local commit: `ac36448956`
- Current local commit(s): v1 `ac36448956`, merge `f8f7cf2e33`; `2c4bd2a36a`, merge `cead509aa0`; initial catalog `e325048346f`; native v2 `99ff4b4cc47065777136ff0d3d89b0466a21ebb7` on `native-tool-discovery` and `v2-nowaker`
- Upstream base when introduced: `006d837c50` (`v1.19.5`, `github/v1`)
- Last checked against upstream: `006d837c50`

## Original request

> i would generally wan a hybrid. i'd like to define which oc tools are always exposed, and which ones are behind a list.

## Original v1 goals

- A `tool.deferral` plugin hook decides, per tool of every request (built-in, plugin, MCP), whether it is sent with `defer_loading`.
- With `@ai-sdk/openai` the Responses `tool_search` tool is added when any tool is deferred.
- Without the hook, requests are byte-identical to before.

## Original v1 non-goals

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
| `2c4bd2a36a` | 2026-11-10 | The agent permission filter stripped `tool_search` while deferred tools it allowed stayed, so OpenAI rejected every explore request ("Deferred tools require tools.tool_search"); permissions now leave `tool_search` alone and drop it only when nothing is deferred ([session](../sessions/2026-11-10-defer-search-permission.md)) | `resolveTools` in `session/llm/request.ts`; `test/session/llm-request.test.ts` |
| `cead509aa0` | 2026-11-10 | Fork merge, no conflicts | - |
| `e325048346f` | 2026-11-16 | Initial name-and-purpose catalog for callable deferred tools, preserving eager schemas and internal tool repair | `session/llm/request.ts`, `session/llm.ts`, `test/session/llm-request-catalog.test.ts`; [delivery](../sessions/2026-11-16-essential-tool-exposure.md) |

## Verification

- `bun test test/session/tools.test.ts`: 8 pass. `bun run typecheck` in `packages/opencode` and `packages/plugin`: clean.
- Run from source with a scratch plugin deferring all but read/write/edit/bash/glob/grep: Claude Haiku through Meridian completed webfetch, Meridian telemetry recorded 10 tools with 4 deferred (below its auto-defer threshold, so the marks were the client's); GPT-5.6 luna through Meridian called `tool_search` then webfetch.
- Same through opencode-tools `toolDeferral.*` settings and the opencode-lazy-mcp-plugin: both providers passed.
- Installed `1.19.5-vt-407-006d837c50` on desktop; v2 guard gate passed.
- 2026-11-10: `llm-request.test.ts` fails on the old code (0/2) and passes with the fix; installed `1.19.5-vt-436-006d837c50` on both hosts, and a GPT explore run answered.

## V1 initial tool catalog

- Every callable tool deferred for the active OpenAI or Anthropic SDK appears in initial system context, or OpenAI OAuth instructions, with its name and first description paragraph normalized and capped at 240 characters. The catalog has no tool-count cap and contains no parameter schemas.
- The catalog and `Prepared.activeTools` share the same permission-filtered provider exposure set. The internal `invalid` handler remains available for repair but is neither advertised nor serialized as an active tool; Copilot's compatibility `_noop` remains active when needed. Eager schemas, plugin instructions and executors retain their existing paths.
- Vibeterm's companion policy keeps essential coding, monitoring, research and routine session/worktree tools directly callable. Existing configured selectors are preserved when activating the expanded policy; specialist schemas still load through discovery.
- Source verification passes 24 tests and 156 assertions. The installed plugin/engine suite passes 43 tests and 208 assertions, and both expanded installed-runtime cases pass independently on desktop. Both hosts install `1.19.5-vt-504-006d837c50` after their mandatory v1 database guard passes. The [session record](../sessions/2026-11-16-essential-tool-exposure.md) owns the baseline failures, review correction, typecheck limits, build artifacts and live direct-tool proof.

## Native v2 implementation

- Both Promise and Effect Session context hooks receive mutable `deferred?: boolean` tool entries. Awaited hook output is request-local, deeply copied and reconciled against captured executor identity; an alias continues to execute the original tool. Omission and false preserve eager declarations.
- Core uses the canonical native AI tool-search descriptors for `openai-responses` and `anthropic-messages`; unsupported protocols fail before transport. Unlike the original v1 Meridian contract above, native Anthropic requests include an explicit regex descriptor, with the canonical AI API also supporting BM25. The consumer owns deployment/model eligibility, eager and reserved-tool policy; Code Mode and native permission boundaries are preserved.
- Stable seams: `packages/core/src/session/model-request-tools.ts`, `ModelRequest.prepare` and `tools.execute({ definitions: hooked })`; plugin `ToolDefinition.deferred`; `packages/ai/src/tool-search.ts`; protocol declaration, cache and hosted-item/replay owners under `packages/ai/src/protocols/utils/`; validation in ordinary and both explicit compaction routes. Protocol/Server info and generated Client surfaces expose optional `toolDeferral`.
- OpenAI object search arguments, nullable call IDs, original/normalized item identity and raw provider metadata survive stored-history replay. Anthropic response-local regex/BM25 identity and nested success, empty and error content survive normalization and replay. Explicit incompatible cache hints and `http.body.tools` overlays refuse before dispatch.
- Corrected source gate: 404 AI tests / 1,235 assertions, 8 Core tests / 57 assertions, current canonical 34/34, zero corrected literal diagnostics and eight restored-owner mutation failures. Two canonical client generation passes preserve all eight outputs. The retained Oracle closes both required compaction/extraction findings on exact 38-path snapshot `137b5d9548e11c475d36a3cc0104d43ae6683f519caf2bde2dab9c80b2d09c81`.
- Both hosts independently install `opencode v2.2.7-vt-37-5f76acb125` from source `99ff4b4cc4`, each passing the mandatory native 12/12 gate and an isolated installed `toolDeferral: true` response. The same frozen private driver passes all 11 compiled scenarios on each host: captured alias execution exactly once, eager/false parity, unavailable-tool refusal, unsupported-protocol zero dispatch and durable native replay. Both owned engines exit zero and providers settle with zero active requests. The [delivery record](../sessions/2026-11-15-native-tool-deferral.md) owns exact artifact identities, command receipts and the source-tested-only BM25/model-eligibility limits.

## Timeline

- 2026-11-16 [Essential tool exposure delivery](../sessions/2026-11-16-essential-tool-exposure.md), [session](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e1cd56b7dffe2F5QL8T66T8wbd) - publish the v1 initial catalog to both mirrors, install it independently on desktop and m4max, activate the shared essential-tool policy and verify direct calls in a fresh session and the restarted delivering tab.
- 2026-11-15 [W1 delivery](../sessions/2026-11-15-native-tool-deferral.md), [full source session](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3832b1b0ffe6q98OeUzhgqhjQ) - native v2 port `99ff4b4cc4` is reviewed, normally published on both primary mirrors and independently installed on desktop and m4max. The earlier interrupted checkpoint remains on its original feature refs; no historical v1 verification is relabeled as v2 evidence.
