# Per-status MCP counts in the sidebar heading

## Identity

- Workday: 2026-10-04
- Session: `ses_ef63ef95cffeIfyDzjCjdXqrYc`
- Agent/platform: `Sisyphus - ultraworker` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-mcp-summary` (worktree under `.vibeterm/worktrees/`, off upstream `dev` `907b3bc518`); landing branch `mcp-summary-land`
- Upstream base: `907b3bc518` (upstream `dev`); unchanged
- Source result commit(s): `712382574a` (cherry-pick of `33fccc3b76` on `tui-mcp-summary`)
- Forklog commit: this file's introducing commit

## User requests

Spawned by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` as effort item 7
("opencode TUI improvements"); the verbatim request is in the
[feature record](../features/2026-10-04-sidebar-mcp-summary.md#original-request).

## Goals

- Optional per-status colored counts on the sidebar MCP heading, with
  `default`/`collapsed`/`never`/`always` visibility; `always` on desktop and
  m4max.
- Same change offered upstream.

## Constraints and non-goals

- Diff kept to `mcp.tsx`, the config schema, a config test and one docs line,
  because sibling items 5 and 6 edit the same sidebar and `Sidebar` struct.
- No TUI tab, service, or vibeterm tmux server restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `4d32fb9537` | `712382574a` + this forklog commit | cherry-pick onto `mcp-summary-land` (folded `mcp_summary` into the existing `Sidebar` struct; kept both sides of the config test and docs conflicts), rebase past the compact-context separator fix, fast-forward; pushed to `origin` and `nowaker-github` |
| `opencode` (GitHub fork) | `tui-mcp-summary` | - | `33fccc3b76` | new branch off upstream `dev` `907b3bc518`; head of PR #53261; also pushed to `origin` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Per-status MCP counts in the sidebar heading](../features/2026-10-04-sidebar-mcp-summary.md) | introduced | typecheck; config/keymap tests; vanilla and per-mode tmux frames |

## Other delivered work

- Upstream issue [#53260](https://github.com/anomalyco/opencode/issues/53260)
  (issue-first policy) and PR
  [#53261](https://github.com/anomalyco/opencode/pull/53261), opened with
  `~/.local/bin/gh`.

## Verification

- `bun typecheck` in `packages/tui` - exit 0 on both branches;
  `bun test test/config.test.tsx test/keymap.test.tsx` - 11 pass on
  `dev-nowaker`.
- Manual surface: see the feature record's Verification section (tmux socket
  `oc-tui-mcp`, isolated `XDG_*`, six MCP servers in mixed states).

## Build and install

- Build command: `.vibeterm/build.sh` (with `TMPDIR` in the checkout's `tmp/`)
  at `712382574a` on desktop, and on m4max after fast-forwarding its checkout
  from `f8f513a75a`.
- Installed artifact: `1.18.34-vt-85-907b3bc518` on both hosts (desktop inode
  `49955776`); both binaries contain `mcp_summary`.
- Host setting: `sidebar.mcp_summary: "always"` added to
  `~/.config/opencode/tui.json` on both hosts by an atomic read-modify-write
  that kept every other key (`sidebar.pin_title`, `sidebar.context`
  included); the desktop file decodes with `TuiConfig.Info`.
- Running services: none restarted on either host.

## Commit provenance

- `712382574a` - sidebar change.
- Required trailer: `AI-Session-ID: ses_ef63ef95cffeIfyDzjCjdXqrYc`

## Unknowns and blocked verification

- None.
