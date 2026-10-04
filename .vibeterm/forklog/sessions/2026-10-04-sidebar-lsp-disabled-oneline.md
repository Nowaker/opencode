# One-line "LSPs are disabled" in the sidebar

## Identity

- Workday: 2026-10-04
- Session: `ses_ef81b0c61ffe9TD8cftI93JGis`
- Agent/platform: `Sisyphus - ultraworker` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-lsp-oneline` (worktree under `.vibeterm/worktrees/`, off upstream `dev` `907b3bc518`)
- Upstream base: `907b3bc518` (upstream `dev`); unchanged
- Source result commit(s): `1f2bfda9bd` (cherry-pick of `8bc6c110d2` on `tui-lsp-oneline`)
- Forklog commit: this file's introducing commit

## User requests

Spawned by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` as effort item 4C
("opencode TUI improvements"), quoting the user:

> for this specific condition:
> LSP
> LSPs are disabled
> Convert to one line: LSPs are disabled. LSPs in brighter color like LSP word
> is now. then there is content to be printed in lsps section, then it
> continues to be multiline

## Goals

- One-line LSP section when LSP is disabled; multi-line otherwise.
- Same change offered upstream.

## Constraints and non-goals

- No setting. Diff kept to `lsp.tsx` because sibling sessions 4A, 4B and 4D
  edit the same sidebar.
- Landed only after the reintegration session
  `ses_ef81db9cdffe5vRz7Y2HqCmvNs` declared `dev-nowaker` `6636d662fa` final.
- No TUI tab or vibeterm tmux server restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `6636d662fa` | `1f2bfda9bd` + this forklog commit | cherry-pick from `tui-lsp-oneline`, fast-forward; pushed to `origin` and `nowaker-github` |
| `opencode` (GitHub fork) | `tui-lsp-oneline` | - | `8bc6c110d2` | new branch off upstream `dev` `907b3bc518`; head of PR #53185 |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [One-line "LSPs are disabled" in the sidebar](../features/2026-10-04-sidebar-lsp-disabled-oneline.md) | introduced | typecheck; before/after tmux frames |

## Other delivered work

- Upstream issue [#53183](https://github.com/anomalyco/opencode/issues/53183)
  (issue-first policy) and PR
  [#53185](https://github.com/anomalyco/opencode/pull/53185).

## Verification

- `bun typecheck` in `packages/tui` - exit 0 on both branches; pre-push full
  typecheck of `tui-lsp-oneline` - 30/30 tasks.
- Manual surface: `bun dev` from the worktree in tmux socket `oc-tui-lsp`
  (200x45), isolated `XDG_*` dirs, a fake OpenAI-compatible provider on
  127.0.0.1, one prompt per run. Vanilla `907b3bc518` with `"lsp": false`:
  `LSP` / `LSPs are disabled` on two lines (reproduced). Patched: one line,
  `LSPs` in the heading color and ` are disabled` muted (checked with
  `capture-pane -e`). Patched with `"lsp": true`: two lines, unchanged.

## Build and install

- Recorded by this session's follow-up forklog commit, after the build on
  both hosts.

## Commit provenance

- `1f2bfda9bd` - sidebar change.
- Required trailer: `AI-Session-ID: ses_ef81b0c61ffe9TD8cftI93JGis`

## Unknowns and blocked verification

- `/tmp` writes failed with "disk quota exceeded" during this session (zsh
  heredocs); scratch moved into the worktree's `tmp/`. Not investigated.
