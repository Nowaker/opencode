# One-line "LSPs are disabled" in the sidebar

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-lsp-oneline` (off upstream `dev` `907b3bc518`; also the upstream PR head)
- First local commit: `1f2bfda9bd`
- Current local commit(s): `1f2bfda9bd`
- Upstream base when introduced: `907b3bc518` (upstream `dev`)
- Last checked against upstream: `907b3bc518` (upstream `dev`)
- Upstream: issue [#53183](https://github.com/anomalyco/opencode/issues/53183), PR [#53185](https://github.com/anomalyco/opencode/pull/53185)

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (effort item 4C),
quoting the user:

> for this specific condition:
> LSP
> LSPs are disabled
> Convert to one line: LSPs are disabled. LSPs in brighter color like LSP word
> is now. then there is content to be printed in lsps section, then it
> continues to be multiline

## Goals

- With `"lsp": false` and no servers listed, the sidebar LSP section is one
  line: `LSPs` in the heading style, ` are disabled` in `textMuted`.

## Non-goals

- No setting; pure presentation.
- Every other LSP state keeps the heading + content layout, including
  "LSPs will activate as files are read" with LSP enabled and no server yet.
- Other sidebar sections are untouched; they render nothing when empty, so
  LSP is the only one with a two-line empty state.

## Rationale and constraints

- The 40-column sidebar spent two lines on one fact.
- Uses the muted-span-inside-heading idiom of the collapsed MCP heading.
- The diff stays inside `lsp.tsx` because sibling sessions 4A, 4B and 4D
  change `sidebar.tsx`, the sidebar config and section ordering.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `1f2bfda9bd` | 2026-10-04 | `off()` also requires an empty server list; when true the heading reads `LSPs` plus a muted ` are disabled` span and the content line is skipped | `View` in `packages/tui/src/feature-plugins/sidebar/lsp.tsx` |

## Verification

- `bun typecheck` in `packages/tui` - exit 0 on `tui-lsp-oneline` and on
  `dev-nowaker`; pre-push full typecheck of the upstream branch - 30/30.
- Manual surface: `bun dev` in a 200x45 throwaway tmux socket, isolated XDG
  dirs, a local fake OpenAI-compatible provider, one prompt. Before (upstream
  `907b3bc518`): `LSP` / `LSPs are disabled` on two lines. After: one line
  `LSPs are disabled`, `capture-pane -e` showing `LSPs` in the heading color
  (238) and ` are disabled` in the muted color (128). With `"lsp": true`:
  `LSP` / `LSPs will activate as files are read`, unchanged.

## Timeline

- 2026-10-04
  [`ses_ef81b0c61ffe9TD8cftI93JGis`](../sessions/2026-10-04-sidebar-lsp-disabled-oneline.md)
  - `1f2bfda9bd`: introduce; open upstream issue #53183 and PR #53185.

## Current maintenance notes

- Drop the fork commit once PR #53185 (or an equivalent) is in upstream `dev`.

### Upstream integration checklist

- Locate the `LSP` heading and the "LSPs are disabled" text in
  `packages/tui/src/feature-plugins/sidebar/lsp.tsx`.
- Run `bun typecheck` in `packages/tui`.
- With `"lsp": false`, check the sidebar shows one `LSPs are disabled` line.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
