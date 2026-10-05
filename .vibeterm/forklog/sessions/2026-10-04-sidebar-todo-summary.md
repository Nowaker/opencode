# Todo counts after the sidebar Todo heading

## Identity

- Workday: 2026-10-04
- Session: `ses_ef6415913ffeq4hyR0MCqsjDsn`
- Agent/platform: `Sisyphus - ultraworker` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-todo-summary` (worktree under `.vibeterm/worktrees/`, off upstream `dev` `907b3bc518`); landing branch `todo-land`
- Upstream base: `907b3bc518` (upstream `dev`); unchanged
- Source result commit(s): `5c5fc747e0` (rebase of `a898cc87d2` on `tui-todo-summary`)
- Forklog commit: this file's introducing commit

## User requests

Spawned by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` as effort item 6
("opencode TUI improvements"); the verbatim request is in the
[feature record](../features/2026-10-04-sidebar-todo-summary.md#original-request).

## Goals

- Optional todo counts after the sidebar Todo heading, in two styles and
  three visibility modes; `always` on desktop and m4max.
- Same change offered upstream.

## Constraints and non-goals

- Diff kept to `todo.tsx`, the config schema, a config test case, a
  formatter test and one docs line, because sibling sessions 5 and 7 edit the
  same sidebar and `Sidebar` struct.
- Key naming coordinated with item 7 (`ses_ef63ef95cffeIfyDzjCjdXqrYc`,
  `sidebar.mcp_summary`).
- No TUI tab, service or vibeterm tmux server restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `712382574a` | `5c5fc747e0` + this forklog commit | cherry-pick onto `todo-land`, rebase past the 4D drag landing, the compact-context dot fix and item 7's MCP summary (merged into one `Sidebar` struct, kept 4D's `onHeaderClick`), fast-forward; pushed to `origin` and `nowaker-github` |
| `opencode` (GitHub fork) | `tui-todo-summary` | - | `a898cc87d2` | new branch off upstream `dev` `907b3bc518`; head of PR #53259 |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Todo counts after the sidebar Todo heading](../features/2026-10-04-sidebar-todo-summary.md) | introduced | typecheck; config/formatter/keymap tests; tmux frames |

## Other delivered work

- Upstream issue [#53258](https://github.com/anomalyco/opencode/issues/53258)
  and PR [#53259](https://github.com/anomalyco/opencode/pull/53259), opened
  with `~/.local/bin/gh`.

## Verification

- `bun typecheck` in `packages/tui` - exit 0 on `tui-todo-summary` and on
  `todo-land`; `bun test test/config.test.tsx test/feature-plugins/
  test/keymap.test.tsx` - 36 pass on `todo-land`.
- Manual surface: see the feature record's Verification section (tmux socket
  `oc-tui-todo`, isolated `XDG_*`, fake provider on 127.0.0.1:37671),
  repeated on each landing rebase.

## Build and install

- Build command: `.vibeterm/build.sh` (with `TMPDIR` in the checkout's `tmp/`)
  on desktop at `5c5fc747e0`, and on m4max after fast-forwarding its checkout
  from `712382574a` to `5c5fc747e0`.
- Installed artifact: desktop `1.18.34-vt-86-907b3bc518` (inode `49955786`),
  m4max `1.18.34-vt-86-907b3bc518`; both binaries contain
  `todo_summary_style`, desktop also the retry-header marker.
- Host setting: `sidebar.todo_summary: "always"` and
  `sidebar.todo_summary_style: "progress"` added to
  `~/.config/opencode/tui.json` on both hosts by an atomic read-modify-write
  that kept every other key; the desktop file decodes with `TuiConfig.Info`.
- Running services: none restarted on either host.

## Commit provenance

- `5c5fc747e0` - sidebar change.
- Required trailer: `AI-Session-ID: ses_ef6415913ffeq4hyR0MCqsjDsn`

## Unknowns and blocked verification

- None.
