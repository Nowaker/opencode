# Essential tools and an initial deferred-tool catalog

## Identity

- Workday: 2026-11-16.
- Session: [`ses_e1cd56b7dffe2F5QL8T66T8wbd`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e1cd56b7dffe2F5QL8T66T8wbd), OpenCode / darwin on m4max.
- Implementation worker: [`ses_e1cc9a881ffe2827rDHp14lvIw`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e1cc9a881ffe2827rDHp14lvIw).
- Repository: `/Volumes/projects/webapps/opencode`; integration branch `dev-nowaker`; managed branch `deferred-tool-catalog` from `422364dc84e2a666459d2bccbb073394cceb5f21`.
- Upstream base: `006d837c50`, v1.19.5. Source result: `e325048346f378be011fcf0fbaf9488a02407ff3`. Forklog commit: this file's introducing commit.

## User request

> it appears basic tool calls are also hidden behind tool list call. You  must prepare a list of most important tool calls that are always present in the system prompt. And expose them, always. Only tools of lower frequency of use should require a tool search. But don't mistake a tool being new (like monitor) for being used infrequently.

> Also, we probably want something in between. A list of tools is always provided, so the AI knows of their existence and can have a general idea what they can do, but has to use a tool call to learn how to use them. (or maybe it already works that way?)

## Delivered behavior

- [Tool deferral](../features/2026-11-07-tool-deferral-hook.md) now includes a compact initial catalog of every callable deferred tool's name and purpose. Full schemas still load through the existing provider search; eager tool definitions are unchanged.
- Catalog construction follows agent/session permissions and disabled-tool filtering, checks the active SDK's exact `deferLoading: true` flag, and uses the same exposed set as `Prepared.activeTools`. Descriptions use their first paragraph, normalized to one line and capped at 240 characters; all remaining names are retained.
- OpenAI, Anthropic and OpenAI OAuth request serialization are covered. OAuth retains plugin instructions. The internal `invalid` repair executor stays available internally but is absent from the catalog and provider tools; Copilot's compatibility `_noop` stays active.
- Companion opencode-tools commits [5319eaa46](https://gitlab.com/Nowaker/opencode-tools/-/commit/5319eaa46c7c1e21068aaa32f81f82286f0793d2) and [3eb86879586](https://gitlab.com/Nowaker/opencode-tools/-/commit/3eb86879586) expand the direct policy to 40 selectors and verify the installed catalog. The canonical list is [Vibeterm FEATURES](https://gitlab.com/Nowaker/opencode-tools/-/blob/master/vibeterm-opencode-client/FEATURES.md#which-tools-ride-in-every-request-tooldeferral).
- The shared setting was updated through its master-aware writer, preserving configured selector order and extras. A desktop read confirms `enabled=true`, `monitorDeferred=false` and `sessionPromptDeferred=false`.

## Verification and review

- The initial catalog regression fails three OpenAI/Anthropic/OAuth cases before the source fix. Worker mutations that bypass permission filtering or ignore the active SDK each fail six cases and are restored before verification.
- The first [gate review](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e1cb4b625ffe4vUomnhul8fWMV) finds that internal `invalid` would be advertised while production excludes it. The added sentinel reproduces three wire failures. Sharing the active set corrects the cause, with a [fresh approving review](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e1ca9579cffdyjSY58vaR3E4HH).
- From `packages/opencode`, `bun run test test/session/llm-request-catalog.test.ts test/session/llm-request.test.ts test/session/tools.test.ts` passes 24 tests and 156 assertions; package `bun run typecheck`, changed-file diagnostics, formatting and diff checks pass. Source gate: `/Users/nowaker/.local/share/opencode/tool-output/tool_1e3542204001iEvChVxkG3ZkU4`; typecheck: `/Users/nowaker/.local/share/opencode/tool-output/tool_1e354220c001NSaVPlPvKCutHp`.
- In the opencode-tools worktree, `OPENCODE_V1_BINARY=/Volumes/projects/webapps/opencode-build/bin/opencode bun test _lib/tool-deferral/ opencode-lazy-mcp-plugin/` passes 43 tests and 208 assertions against the installed engine. The archived old engine fails both expanded catalog cases because no catalog is present. Final gate: `/Users/nowaker/.local/share/opencode/tool-output/tool_1e3683376001ibOA5XI0N6SMEH`.
- Installed-runtime fixtures use real engines, the shipped policy plugin, a loopback provider, real `read`/`bash`, and explicitly harmless monitor/background/session stand-ins. The first provider response calls monitor without search and receives its persisted executor receipt. A specialist's name and purpose are present initially; eager tools and `invalid` stay outside the catalog. Native v2 hosted specialist discovery remains covered by the existing plugin suite.
- Desktop independently passes the same two installed-runtime cases with 90 assertions. Its receipt also contains the live shared-policy check: `/Users/nowaker/.local/share/opencode/tool-output/tool_1e36fc512001q5mCkeSlYr2NaZ`.
- The [fresh live demonstration](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e1c96d660ffeCkXatfYjQVv5tH) calls only `vibeterm_list_sessions` and `monitor` directly. Monitor emits `Darwin` and exits zero; the initial catalog supplies `dh-claude-fleet-security_detections` and its purpose while its full schema is absent. The parent inspects the transcript and confirms no discovery call. After an in-place restart, the delivering session also calls `vibeterm_list_sessions` directly and sees the initial specialist catalog.

## Publication and installation

- Managed landing pushes source `e325048346f378be011fcf0fbaf9488a02407ff3` to GitLab `origin/dev-nowaker`, then normally pushes the same tip to `git@github.com:Nowaker/opencode.git`; both remote tips are independently verified. This checkout has no `nowaker-github` remote, so no git configuration is changed.
- Both hosts install their own `1.19.5-vt-504-006d837c50` from source through `.vibeterm/build.sh`, after frozen dependency installation. Each mandatory guard gate passes against opencode-ai v1.19.5 and @opencode/cli v2.3.0. No binary or partial source set is copied between hosts.
- m4max build log: `/Volumes/projects/nowaker/opencode-tools/.vibeterm/worktrees/feat-essential-tool-exposure/tmp/opencode-catalog-m4max-build.log`; tool receipt: `/Users/nowaker/.local/share/opencode/tool-output/tool_1e364eaa2001mWt4WupdltbilF`.
- Desktop build log: `/home/nowaker/projekty/nowaker/opencode-tools/tmp/opencode-catalog-desktop-build.log`; tool receipt: `/Users/nowaker/.local/share/opencode/tool-output/tool_1e364eaae001mc1htp6x2LzfR2`.
- The intentional primary-checkout retry-header patch and unrelated `.gitignore` edits remain untouched. Only the delivering tab is restarted; no service, default tmux server or other active session is restarted. Owned test engines and providers are disposed, and owned monitors stop or complete.

## Verification limits

- Initial root/plugin typechecking passes with zero errors across two projects. The full four-project check retains unrelated dashboard server/Bun import errors. After integrating parallel work, the plugin check reports one incoming `_lib/rich-clipboard/system-clipboard.ts:36` encoding error; changed test diagnostics remain clean. These unrelated files are not changed by this task.
- The settings file's LSP freshness request times out while its affected typecheck passes. The optional worker audit requires unavailable TypeScript unstable APIs and is not run; no dependency is changed to satisfy it.
- The compact catalog change is v1-specific. Native v2 receives the expanded essential policy and retains its existing hosted search behavior; no additional native catalog port is claimed.
