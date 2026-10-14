# Syntax coloring in tool calls: bash, heredocs, file languages, tool input and output

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `syntax-integration` (worktree off `dev-nowaker`);
  upstream branches `bash-syntax` (`b0d93392c2`), `heredoc-syntax`
  (`c36c6697a3`, stacked on `bash-syntax`), `file-languages` (`e6978e6c42`),
  `tool-input-block` (`6164eba109`), all off `github/v1` `dfb56f76c7`;
  `tool-output-syntax` (`e9809aa4f3`, stacked on `bash-syntax`)
- First local commit: `dfbf7f6836`
- Current local commit(s): `dfbf7f6836`, `65861b2734`, `60edf2a182`, `8a360b4aa0`,
  `b23685155c`, `91e33c557e`, `84d27d0f49`, `8e3a183698`, `0ab6637c9d`, `4c00002ca0`, `246c6c10f2`
- Upstream base when introduced: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Last checked against upstream: `dfb56f76c7`
- Upstream: issues #54700-#54703, #54957; PRs
  [#54704](https://github.com/anomalyco/opencode/pull/54704) (bash),
  [#54705](https://github.com/anomalyco/opencode/pull/54705) (heredoc, stacked on #54704),
  [#54706](https://github.com/anomalyco/opencode/pull/54706) (file languages),
  [#54707](https://github.com/anomalyco/opencode/pull/54707) (tool input),
  [#54968](https://github.com/anomalyco/opencode/pull/54968) (tool output, stacked on #54704), all against `v1`.
  **Needs a v2 port later.**

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 33); the user
approved "Build all four". The user's words on defaults:

> i think 1-3 is fine as upstream default - after all, they do coloring for
> some of their own calls, so they are okay with that

## Goals

- The bash tool's command is colored as shell code.
- Each heredoc body is colored in the language of the command that reads it.
- write, edit, apply_patch and the permission diff color SQL, Dockerfiles,
  ini/systemd units, dotenv, shell scripts, Makefiles, Terraform, ERB, HAML
  and `#!` files; a running write shows its content.
- Plugin/MCP tool input can show as a YAML-style block.
- Highlighting is lazy (plain first) and cached by content and language.
- The colored bash command lays out byte-identically to the plain one.
- Code inside a tool call (bash command, heredoc bodies, tool input) never
  draws in red or the theme's error color: red means a failed tool call.

## Non-goals

- `read` shows no file content; unchanged.
- No new highlighting library: opentui's tree-sitter worker only.
- An unknown heredoc consumer keeps bash's string color; no guessing.

## Rationale and constraints

- tree-sitter-bash marks a heredoc body without a language, and opentui's
  `injectionMapping` maps only fixed node types, so `highlightHeredocs`
  merges a second highlight of the body through `<code onHighlight>`.
- nvim-treesitter's bash query relies on `#lua-match?`, which web-tree-sitter
  ignores; `narrowBashHighlights` reapplies those patterns and drops `@spell`
  (the theme colors spell as plain text, overriding comments). The bundled
  sql/ini queries drop `@spell` for the same reason.
- SQL, Dockerfile, ini and HAML publish no wasm; `packages/tui/src/parsers`
  bundles builds (sources and rebuild command in its README).

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `dfbf7f6836` | 2026-10-11 | bash command through `<code filetype="bash">`; `syntax.bash` (default on) | `ShellCommand` in `routes/session/index.tsx`; `util/highlight-cache.ts` `cachedTreeSitterClient`; `util/bash-highlight.ts`; `Syntax` in `config/index.tsx` |
| `65861b2734` | 2026-10-11 | heredoc language inference; `syntax.heredoc` (default on) | `util/heredoc.ts` `heredocs`, `heredocLanguage`, `highlightHeredocs`; `shellHighlights` in `routes/session/index.tsx` |
| `60edf2a182` | 2026-10-11 | `detectFiletype`, bundled grammars, erb parser, running write as code; `syntax.files` (default on) | `util/filetype.ts` `detectFiletype`; `parsers-config.ts`; `packages/tui/src/parsers/`; `fileLanguage` and `Write` in `routes/session/index.tsx`; `permission.tsx` |
| `8a360b4aa0` | 2026-10-11 | generic tool input block; `syntax.tool_input` (default off) | `util/tool-input.ts`; `GenericTool`, `ToolInput` in `routes/session/index.tsx` |
| `b23685155c` | 2026-10-11 | bash command as one `<text>` of spans (layout identical to plain); non-red `toolSyntax` for command and heredocs | `ShellCommand`, `CommandSpans`, `shellHighlights` in `routes/session/index.tsx`; `theme/tool-code.ts` `toolCodeTheme`; `toolSyntax` in `context/theme.tsx`; `highlightCached`; `test/cli/tui/shell-command.test.tsx`, `test/tool-code-theme.test.ts` |
| `91e33c557e` | 2026-10-11 | tool input keys and values from `toolCodeTheme` | `code` memo in `GenericTool` |
| `8e3a183698` | 2026-10-12 | opencode typecheck: declare `*.scm` imports | `packages/opencode/src/audio.d.ts` |
| `246c6c10f2` | 2026-10-12 | heredoc targets detected like the file tools (`cat > x.slice` colored as ini); `.swap`, `.device`, `.image`, `.build` -> ini | `fileLanguage` in `util/heredoc.ts` calls `detectFiletype`; `EXTENSIONS` in `util/filetype.ts` |
| `4c00002ca0` | 2026-10-12 | under the tool input block a response hidden by the generic output toggle is held: "Click to expand" reveals it | `toolOutputReach` in `util/tool-input.ts`; `GenericTool` |
| `0ab6637c9d` | 2026-10-12 | generic tool output colored by `syntax.tool_output` (tool name or glob -> language, `auto`, `none`; unset = plain); JSON sniff for `auto`; collapsed preview takes the whole output's highlights | `outputLanguage`, `detectOutputLanguage`, `previewHighlights` in `util/tool-output.ts`; `ToolOutputText`, `StyledOutput` in `routes/session/index.tsx`; `test/cli/tui/tool-output.test.tsx`, `test/util/tool-output.test.ts` |
| `84d27d0f49` | 2026-10-12 | collapsed tool input: one row per value cut to the measured width; compact YAML lists | `formatToolInput(input, width)` in `util/tool-input.ts`; `inputWidth`/`onWidth` in `GenericTool`/`ToolInput`; `test/cli/tui/tool-input.test.tsx` |

Docs: `Syntax highlighting` section in `packages/web/src/content/docs/tui.mdx`.

## Verification

Reported by `ses_ed1e2b932ffe6tTqhsOiGuYXRE`; see its
[session record](../sessions/2026-10-11-tool-syntax-coloring.md).

## Timeline

- 2026-10-11 [`ses_ed1e2b932ffe6tTqhsOiGuYXRE`](../sessions/2026-10-11-tool-syntax-coloring.md) -
  initial build of all four parts, upstream issues and PRs, install on both hosts.
  Evidence: `dfbf7f6836`..`8a360b4aa0`.
- 2026-10-11 [`ses_ed1e2b932ffe6tTqhsOiGuYXRE`](../sessions/2026-10-11-tool-syntax-coloring.md) -
  user-reported regressions fixed: the colored command lost the space after
  `$`, hung continuations one column in and ran past the block width; tokens
  and tool input keys drew in red. Upstream branches amended, PRs updated.
  Evidence: `b23685155c`, `91e33c557e`; layout and theme tests; PTY at 80/160.
- 2026-10-12 [`ses_ed1e2b932ffe6tTqhsOiGuYXRE`](../sessions/2026-10-12-tool-input-compact.md) -
  user feedback: a collapsed tool input block showed keys with a bare `…`.
  Values now take one row each, and lists are compact YAML; PR #54707 amended.
  Evidence: `84d27d0f49`; frames at 40/80/160; PTY at 80/160; A/B vs vt-241.

- 2026-10-12 [`ses_ed1e2b932ffe6tTqhsOiGuYXRE`](../sessions/2026-10-12-tool-input-compact.md) -
  user feedback: JSON returned by `browser` was drawn plain. `syntax.tool_output`
  added, `auto` ships (sniff measured cheap); issue #54957, PR #54968.
  Evidence: `0ab6637c9d`; frames at 40/80/160; PTY at 80/160; A/B on vt-252.
- 2026-10-12 [`ses_ece4671adffe4Y4d8Yv35NSjXh`](../sessions/2026-10-12-v1-v2-patch-rig.md) -
  rig run: `bash-syntax`, `heredoc-syntax`, `file-languages` proved on `v1.19.0`, `tool-input-block` applies; v2 port cost M each. See the [matrix](../README.md#tui-patches-on-v1-and-v2).
- 2026-10-12 [`ses_ed1e2b932ffe6tTqhsOiGuYXRE`](../sessions/2026-10-12-tool-input-compact.md) -
  user report: Perplexity calls could not be expanded. With `tool_input` on and
  the generic output toggle off, the input block offered no hint or click.
  Fixed; PR #54707 amended. Evidence: `4c00002ca0`; PTY click at 40/80/160.
- 2026-10-12 [`ses_ed1e2b932ffe6tTqhsOiGuYXRE`](../sessions/2026-10-12-tool-input-compact.md) -
  user question "support for systemd units coloring?": heredoc bodies written to
  unit files were a shell string; now ini. PRs #54705 and #54706 amended.
  Evidence: `246c6c10f2`; two-heredoc frames at 40/80/160; PTY at 80/160.
- 2026-10-14 [`ses_ec57be11affe3kxXJ4WyM3OwOY`](../sessions/2026-10-14-user-message-markdown.md) -
  `toolCodeTheme` gains the markdown slots for colored user messages, and the
  tool input block's colors become `toolInputColors`, shared with YAML message
  blocks. See [markdown in user messages](./2026-10-14-user-message-markdown.md).
  Evidence: `5e5994b93a`, `748601cc2b`; `tool-code-theme.test.ts`.

## Future ideas

- A tool declaring its output's content type, so the TUI colors it without
  config: a plugin SDK property such as
  `tool({ ..., output: { contentType: "application/json" } })`, and an MCP
  result's `mimeType`, mapped to a language before `syntax.tool_output` is
  consulted. Raised as a follow-up in PR #54968. Not built.

## Current maintenance notes

- The four upstream branches carry no AI trailers; the fork commits do.
- Bundled grammar rebuild: `packages/tui/src/parsers/README.md`.
- `theme/tool-code.ts` is byte-identical on `bash-syntax` and
  `tool-input-block`, so the two upstream branches merge cleanly.
- write, edit and apply_patch still use the regular `syntax()` palette, so a
  builtin type in a diff (SQL `TEXT`) draws in the error color.
- Upstream, `util/heredoc.ts` (#54705) still maps targets through `filetype`;
  `detectFiletype` is in #54706. Whichever lands second switches
  `fileLanguage` to `detectFiletype` (noted in #54705's body).
- On an opentui bump, re-check `treeSitterToTextChunks` and that `<diff>`
  accepts `filetype` for the new parsers.
