# End every tool call that runs past a time limit

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tool-timeout` (fork), `tool-call-limit` (upstream PR)
- First local commit: `d107564059`
- Current local commit(s): `d107564059`, `fd28603b98`
- Upstream base when introduced: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Last checked against upstream: `dfb56f76c7`
- Upstream PR: [anomalyco/opencode#54503](https://github.com/anomalyco/opencode/pull/54503)
  (base `v1`, head `Nowaker:tool-call-limit` = `49691d403e`); closes #53433

## Original request

> Build a hard time limit on every tool call into our opencode fork
> (/Volumes/projects/webapps/opencode, integration branch `dev-nowaker`).
> Document it, open an upstream PR, and install the build on m4max and
> desktop. The user approved this design.

The full design (resolution levels, built-in exemptions, bash interaction, a
"no limit" value, the plugin and MCP declarations) is in the spawn prompt of
`ses_ed5bde150ffepnn3xqxHaucDLN`.

## Goals

- A tool call still running past its limit ends like an abort: the part
  becomes `error` naming the limit and its source, and the turn continues.
- The most specific setting wins: `tool_timeout.<tool>`, then the provider's
  default (plugin `tool({ timeout })`, MCP `tool_timeout`, built-in
  exemptions), then `tool_timeout.default`, else 30 minutes.
- `question`, `task` and `call_omo_agent` have no limit unless configured.
- `read`, `write`, `edit`, `grep` and `glob` default to 10 minutes, or a lower
  `tool_timeout.default`; a higher default or `false` does not lift them.
- bash's own `timeout` raises its limit unless `tool_timeout.bash` is set.

## Non-goals

- Bounding model streams (#53747) or subagent budgets (#46461).
- A per-tool MCP hint: the MCP spec has none, so the server entry is the
  provider level.

## Rationale and constraints

- A `vibeterm_prompt_session` plugin tool hung for 2.5h because nothing ended
  it. Across 616k completed calls, everything but shell, subagent and
  human-wait tools finished by 2.6m at p99.9, and every call in that group
  over 30m was a hang. `task` is legitimately long (p99 47m, 3 over 8h), and
  `question` legitimately waits up to 105h.
- `false` means "no limit", following the provider `timeout` convention.
- Waiting on a permission prompt is held off the clock (`ToolTimeout.Call.hold`).
- The error rejects without waiting for the tool to notice the abort, so a
  tool that ignores `context.abort` still ends on time.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `d107564059` | 2026-10-11 | Limit resolution and enforcement | `packages/opencode/src/tool/timeout.ts` (`ToolTimeout.resolve`, `ToolTimeout.run`) |
| `d107564059` | 2026-10-11 | Every tool path wrapped in `guard` | `SessionTools.resolve` in `packages/opencode/src/session/tools.ts` |
| `d107564059` | 2026-10-11 | `tool_timeout` config record | `ConfigV1` in `packages/core/src/v1/config/config.ts` |
| `d107564059` | 2026-10-11 | MCP server `tool_timeout` | `packages/core/src/v1/config/mcp.ts`, `McpTool.toolTimeout`, `ConfigV2Compat` `Server` |
| `d107564059` | 2026-10-11 | Plugin `tool({ timeout })` | `packages/plugin/src/tool.ts`, `fromPlugin` in `tool/registry.ts` |
| `d107564059` | 2026-10-11 | bash per-call raise | `Tool.Def.callTimeout`, `ShellTool` |
| `fd28603b98` | 2026-10-15 | 10-minute built-in default for the file tools, ripgrep aborted with the call | `FILE_TOOL_MS`/`FILE_TOOLS` in `tool/timeout.ts`; `signal: ctx.abort` in `tool/grep.ts`, `tool/glob.ts` |
| `d107564059` | 2026-10-11 | Docs and SDK | `config.mdx#tool-time-limits`, `custom-tools.mdx#time-limit`, `mcp-servers.mdx`, `plugins.mdx`, `tools.mdx`, v2 `types.gen.ts` |

## Verification

- `bun test test/tool/timeout.test.ts test/session/tools.test.ts test/tool/registry.test.ts test/tool/code-mode.test.ts test/tool/code-mode-integration.test.ts` - 87 pass, on both `dev-nowaker` and upstream `v1`.
- `bun test test/session/prompt.test.ts -t "limit|tool_timeout"` - 3 pass (hanging `.opencode/tool` ended at its limit with the turn continuing; bash raise; `tool_timeout.bash` cap).
- `bun typecheck` in core, opencode, plugin, sdk/js - clean.
- Installed m4max binary `1.19.0-vt-212-dfb56f76c7` with scratch XDG dirs, a never-finishing plugin and a scripted OpenAI-compatible endpoint: declared 3s, `tool_timeout.default` 2s and a 1.5s per-tool override of `timeout: false` each ended at the limit (3002/2005/1503ms) with the expected error; bash `sleep 3` with `timeout: 10000` completed under the 2s default.

## Timeline

- 2026-10-11 [`ses_ed5bde150ffepnn3xqxHaucDLN`](../sessions/2026-10-11-tool-call-time-limit.md) -
  initial build, upstream PR #54503, installs on m4max and desktop.
- 2026-10-15 [`ses_ebbf8304effeyn1vwapV0HP1Bm`](../sessions/2026-10-15-file-tool-limit.md) -
  10-minute default for read/write/edit/grep/glob, added to PR #54503,
  installs on desktop and m4max.

## Current maintenance notes

- On an upstream bump, check that every `execute` in `SessionTools.resolve`
  still goes through `guard` (registry, three MCP resource tools, MCP tools).
- New built-in tools that legitimately wait on a person or a subagent belong
  in `UNLIMITED` in `tool/timeout.ts`; new built-in file tools belong in
  `FILE_TOOLS`.
- The stuck detector's `TOOL_BOUNDS` (opencode-tools
  `_lib/stuck-detector/thresholds.ts`) mirrors the 10-minute file-tool limit.
- Regenerate the SDK with `./packages/sdk/js/script/build.ts` after schema
  changes.

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- Classify the customization as preserved, conflicted, superseded, or removed.
- Reverse any deliberate uncommitted patch before merging, then reapply its
  canonical patch afterward.
- Regenerate derived clients or schemas instead of editing generated files.
- Run the feature's focused tests and affected package typechecks.
- Build through the host's canonical installer and verify the installed binary.
- Confirm protected services kept the same PID and start timestamp.
- Link a new timeline row to the current session record.
- Update `Last checked against upstream`.
