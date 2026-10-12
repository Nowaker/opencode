# Syntax coloring in tool calls: bash, heredocs, file languages, tool input

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `syntax-integration` (worktree off `dev-nowaker`);
  upstream branches `bash-syntax` (`0fceafe3ee`), `heredoc-syntax`
  (`2175f14d05`, stacked on `bash-syntax`), `file-languages` (`f885d7e3ba`),
  `tool-input-block` (`5fa8131033`), all off `github/v1` `dfb56f76c7`
- First local commit: `dfbf7f6836`
- Current local commit(s): `dfbf7f6836`, `65861b2734`, `60edf2a182`, `8a360b4aa0`
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

Docs: `Syntax highlighting` section in `packages/web/src/content/docs/tui.mdx`.

## Verification

Reported by `ses_ed1e2b932ffe6tTqhsOiGuYXRE`; see its
[session record](../sessions/2026-10-11-tool-syntax-coloring.md).

## Timeline

- 2026-10-11 [`ses_ed1e2b932ffe6tTqhsOiGuYXRE`](../sessions/2026-10-11-tool-syntax-coloring.md) -
  initial build of all four parts, upstream issues and PRs, install on both hosts.
  Evidence: `dfbf7f6836`..`8a360b4aa0`.

## Current maintenance notes

- The four upstream branches carry no AI trailers; the fork commits do.
- Bundled grammar rebuild: `packages/tui/src/parsers/README.md`.
- On an opentui bump, re-check that `CodeRenderable` still calls
  `onHighlight` with `(highlights, { content })` and that `<diff>` accepts
  `filetype` for the new parsers.
