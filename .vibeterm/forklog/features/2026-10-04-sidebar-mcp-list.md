# Compact sidebar MCP rows without status text

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-mcp-list` (off upstream `dev` `907b3bc518`; also the upstream PR head)
- First local commit: `14eba13ee7`
- Current local commit(s): `14eba13ee7`
- Upstream base when introduced: `907b3bc518` (upstream `dev`)
- Last checked against upstream: `907b3bc518` (upstream `dev`)
- Upstream: issue [#53321](https://github.com/anomalyco/opencode/issues/53321), PR [#53322](https://github.com/anomalyco/opencode/pull/53322)

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (effort item 8),
quoting the user:

> mcps: descriptive or compact, i don't need to read Connected or Disabled
> when i have green or gray or red or whatnot indicators at them. default:
> opencode's current default, for me on desktop/m4max: compact

## Goals

- `tui.json` `sidebar.mcp_list`: `"descriptive"` (or unset) keeps upstream's
  dot + name + status text rows; `"compact"` shows dot + name only.
- Desktop and m4max `~/.config/opencode/tui.json` set `sidebar.mcp_list` to
  `"compact"`.

## Non-goals

- No change to the MCP heading, its collapsed summary (`sidebar.mcp_summary`),
  the dot colors, or when the list collapses.
- No runtime toggle: the sibling MCP option `mcp_summary` has none either.

## Rationale and constraints

- The dot color already carries the status (connected success, failed and
  needs client ID error, needs auth warning, disabled muted), so the words
  repeat it.
- Compact drops the failure reason as well. It is the one piece of status
  text the dot cannot express, but it is also what wraps over several lines
  of a narrow sidebar; the red dot marks the failure and `/status` lists
  every server with its status, error and auth hint.
- Literals follow the user's words (`descriptive`/`compact`), like
  `sidebar.context` (`expanded`/`compact`). `keybinds.mcp_list` is an
  unrelated existing key in a different namespace.
- `mcp_list` sits beside `mcp_summary` in the shared `Sidebar` struct; the
  upstream PR introduces its own one-key `Sidebar` struct, as #53261 does.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `14eba13ee7` | 2026-10-04 | `sidebar.mcp_list` option, compact rows, config test, docs line | row `<text>` in `View`, `packages/tui/src/feature-plugins/sidebar/mcp.tsx`; `SidebarMcpList`/`Sidebar` in `packages/tui/src/config/index.tsx` |

## Verification

- `bun typecheck` in `packages/tui` - exit 0 on `tui-mcp-list` and on
  `dev-nowaker`; `bun test test/config.test.tsx` (9 pass) on `tui-mcp-list`,
  `test/config.test.tsx test/keymap.test.tsx` (11 pass) on `dev-nowaker`.
- Manual surface: TUI from source in throwaway tmux socket `oc-tui-mcplist`,
  isolated `XDG_*`, fake OpenAI-compatible provider on 127.0.0.1:47972, five
  MCP servers: two stdio servers that connect, one nonexistent command
  (failed), one `enabled: false` (disabled), one remote answering 401 on
  127.0.0.1:47971 (needs auth). Vanilla `907b3bc518` and `descriptive`
  produce the same sidebar text (`• alpha-tools Connected`, the ENOENT reason
  wrapped over three lines, `Disabled`, `Needs auth`); `compact` gives
  `• alpha-tools` ... `• remote-oauth` with the dots still green, green, red,
  gray, orange (`capture-pane -e`). Re-checked `compact` on `dev-nowaker`.

## Timeline

- 2026-10-06 [`ses_eeda1d251ffel81U5Y42j4kb33`](../sessions/fork-audit.md) -
  verify real compact/descriptive rows and dot colors; loss of descriptive
  failure reasons remains an intentional trade-off in the linked inventory.

- 2026-10-04
  [`ses_ef48e41cfffeCewCXcQUj6z1n2`](../sessions/2026-10-04-sidebar-mcp-list.md)
  - `14eba13ee7`: introduce; open upstream issue #53321 and PR #53322;
    build and install on desktop and m4max (`vt-93`); `compact` set in both
    hosts' `tui.json`.

## Current maintenance notes

- Drop the fork commit once PR #53322 (or an equivalent) is in upstream `dev`.
- If #53261 lands first upstream, the PR needs only `mcp_list` added to its
  `Sidebar` struct.

### Upstream integration checklist

- Locate the row `<text>` in `View` in
  `packages/tui/src/feature-plugins/sidebar/mcp.tsx` and `Sidebar` in
  `packages/tui/src/config/index.tsx`.
- Run `bun typecheck` and `bun test test/config.test.tsx` in `packages/tui`.
- With `sidebar.mcp_list: "compact"`, check rows show dot + name only, with
  the dot colors unchanged.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
