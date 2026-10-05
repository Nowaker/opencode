# Compact sidebar MCP rows without status text

## Identity

- Workday: 2026-10-04 (work ran past midnight into 2026-10-05)
- Session: `ses_ef48e41cfffeCewCXcQUj6z1n2`
- Agent/platform: `Sisyphus - ultraworker` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-mcp-list` (worktree under `.vibeterm/worktrees/`, off upstream `dev` `907b3bc518`); landing branch `mcp-list-land`
- Upstream base: `907b3bc518` (upstream `dev`); unchanged
- Source result commit(s): `14eba13ee7` (cherry-pick of `dfce5e4447` on `tui-mcp-list`)
- Forklog commit: this file's introducing commit

## User requests

Spawned by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` as effort item 8
("opencode TUI improvements"); the verbatim request is in the
[feature record](../features/2026-10-04-sidebar-mcp-list.md#original-request).

## Goals

- Optional compact MCP rows (dot + name) in the sidebar, `descriptive` by
  default; `compact` on desktop and m4max.
- Same change offered upstream.

## Constraints and non-goals

- Diff kept to the MCP row rendering, the config schema, a config test and
  one docs line, because sibling sessions edit the same sidebar files.
- No TUI tab, service, or vibeterm tmux server restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `d80de8e705` | `14eba13ee7`, then this forklog commit | cherry-pick onto `mcp-list-land` (folded `mcp_list` into the existing `Sidebar` struct beside `mcp_summary`; kept both sides of the `mcp.tsx`, config test and docs conflicts), fast-forward; pushed to `origin` and `nowaker-github` |
| `opencode` (GitHub fork) | `tui-mcp-list` | - | `dfce5e4447` | new branch off upstream `dev` `907b3bc518`; head of PR #53322; also pushed to `origin` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Compact sidebar MCP rows without status text](../features/2026-10-04-sidebar-mcp-list.md) | introduced | typecheck; config/keymap tests; vanilla, `descriptive` and `compact` tmux frames |

## Other delivered work

- Upstream issue [#53321](https://github.com/anomalyco/opencode/issues/53321)
  (issue-first policy) and PR
  [#53322](https://github.com/anomalyco/opencode/pull/53322), opened with
  `~/.local/bin/gh`.

## Verification

- `bun typecheck` in `packages/tui` - exit 0 on both branches;
  `bun test test/config.test.tsx test/keymap.test.tsx` - 11 pass on
  `dev-nowaker`.
- Manual surface: see the feature record's Verification section (tmux socket
  `oc-tui-mcplist`, isolated `XDG_*`, five MCP servers in mixed states).

## Build and install

- Build command: `.vibeterm/build.sh` (with `TMPDIR` in the checkout's `tmp/`)
  at `f17d9bd206` (contains `14eba13ee7`) on desktop, and on m4max, whose
  checkout was already at `f17d9bd206`.
- Installed artifact: `1.18.34-vt-93-907b3bc518` on both hosts (desktop inode
  `49955935`, m4max inode `21322078`); both binaries contain the
  `mcp_list` schema description.
- Host setting: `sidebar.mcp_list: "compact"` added to
  `~/.config/opencode/tui.json` on both hosts by an atomic read-modify-write
  (temp file with the original mode, then rename); a sorted-JSON diff against
  the previous file shows only that key changed, and both files decode with
  `TuiConfig.Info`.
- Running services: none restarted on either host.

## Commit provenance

- `14eba13ee7` - sidebar change.
- Required trailer: `AI-Session-ID: ses_ef48e41cfffeCewCXcQUj6z1n2`

## Unknowns and blocked verification

- None.
