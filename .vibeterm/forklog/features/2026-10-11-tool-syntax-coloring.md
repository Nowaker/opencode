# Syntax coloring in tool calls: bash, heredocs, file languages, tool input

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `syntax-integration` (worktree off `dev-nowaker`);
  upstream branches `bash-syntax` (`b0d93392c2`), `heredoc-syntax`
  (`bf7cffb240`, stacked on `bash-syntax`), `file-languages` (`f885d7e3ba`),
  `tool-input-block` (`02be94024c`), all off `github/v1` `dfb56f76c7`
- First local commit: `dfbf7f6836`
- Current local commit(s): `dfbf7f6836`, `65861b2734`, `60edf2a182`, `8a360b4aa0`,
  `b23685155c`, `91e33c557e`
- Upstream base when introduced: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Last checked against upstream: `dfb56f76c7`
- Upstream: issues #54700-#54703; PRs
  [#54704](https://github.com/anomalyco/opencode/pull/54704) (bash),
  [#54705](https://github.com/anomalyco/opencode/pull/54705) (heredoc, stacked on #54704),
  [#54706](https://github.com/anomalyco/opencode/pull/54706) (file languages),
  [#54707](https://github.com/anomalyco/opencode/pull/54707) (tool input), all against `v1`.
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

## Current maintenance notes

- The four upstream branches carry no AI trailers; the fork commits do.
- Bundled grammar rebuild: `packages/tui/src/parsers/README.md`.
- `theme/tool-code.ts` is byte-identical on `bash-syntax` and
  `tool-input-block`, so the two upstream branches merge cleanly.
- write, edit and apply_patch still use the regular `syntax()` palette, so a
  builtin type in a diff (SQL `TEXT`) draws in the error color.
- On an opentui bump, re-check `treeSitterToTextChunks` and that `<diff>`
  accepts `filetype` for the new parsers.
