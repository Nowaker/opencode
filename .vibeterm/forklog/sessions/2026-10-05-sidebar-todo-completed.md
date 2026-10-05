# Keep a completed todo list in the sidebar

## Identity

- Workday: 2026-10-05
- Session: `ses_ef49a49d9ffeKmNRrjg4DFrQtW`
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-todo-completed` (worktree under `.vibeterm/worktrees/`, off upstream `dev` `907b3bc518`); landing branch `todo-completed-land`
- Upstream base: `907b3bc518` (upstream `dev`); unchanged
- Source result commit(s): `173921d2f3` (cherry-pick of `2b2413985f` on `tui-todo-completed`)
- Forklog commit: this file's introducing commit

## User requests

> opencode: sometimes i don't see session's todos in opencode, but vibeterm
> top bar is showing them. why is that? maybe because opencode will not 'see'
> todos that are outside of its scrollback or something? investigate what
> that's the case. do people report this issue on github? did people ever
> file PRs? check out; if a patch for that exists, check it out, merge and
> deploy here. treat like it's our own patch. otherwise let's just write one
> ourselves.

> look,i'm not talking about narrow sidebar in opencode.
> i often just don't see any todos.

## Goals

- Explain the mismatch, look for an upstream fix, otherwise patch it.
- Completed todo lists stay visible in the sidebar on desktop and m4max.

## Constraints and non-goals

- Default rendering unchanged (`hide`), so the patch is upstreamable.
- No TUI tab, service or vibeterm tmux server restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `6f6107700b` | `173921d2f3` + this forklog commit | cherry-pick onto `todo-completed-land` (merged into the existing `Sidebar` struct and `todo_summary` view), fast-forward; pushed to `origin` and `nowaker-github` |
| `opencode` (forks) | `tui-todo-completed` | - | `2b2413985f` | new branch off upstream `dev` `907b3bc518`; pushed to `origin` and `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Keep a completed todo list in the sidebar](../features/2026-10-05-sidebar-todo-completed.md) | introduced | typecheck; render and config tests; tmux frames |
| [Todo counts after the sidebar Todo heading](../features/2026-10-04-sidebar-todo-summary.md) | preserved | merged into the same `View`; config and feature-plugin tests pass |

## Other delivered work

- Diagnosis: the TUI and Vibeterm read the same `todo` table. The sidebar hid
  the section once no item was open; scrollback and sync are not involved. A
  pane audit across every Vibeterm tab matched exactly: heading present on
  tabs with open items, absent on every all-completed tab.
- Upstream search: no matching bug or fix; PR #53303 was a closed,
  design-only proposal.

## Verification

- `bun typecheck` in `packages/tui` - exit 0 on both branches;
  `bun test test/config.test.tsx test/feature-plugins/` - 38 pass on
  `todo-completed-land`.
- Manual surface: see the feature record's Verification section.

## Build and install

- Build command: `~/projekty/webapps/opencode-build/build.sh` on desktop;
  `build.sh` on m4max at `4e5523e24f`.
- Installed artifact: desktop `1.18.34-vt-95-907b3bc518` (inode `49955991`),
  binary contains `todo_completed` and the retry-header marker; m4max
  `1.18.34-vt-96-907b3bc518` (inode `21326878`), binary contains
  `todo_completed`.
- Host setting: `sidebar.todo_completed: "show"` added to
  `~/.config/opencode/tui.json` on both hosts with a `jq` read-modify-write
  that kept every other key.
- Running services: none restarted.

## Commit provenance

- `173921d2f3` - sidebar change.
- Required trailer: `AI-Session-ID: ses_ef49a49d9ffeKmNRrjg4DFrQtW`

## Unknowns and blocked verification

- No upstream issue or PR opened.
