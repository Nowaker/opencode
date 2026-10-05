# Per-status MCP counts in the sidebar heading

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-mcp-summary` (off upstream `dev` `907b3bc518`; also the upstream PR head)
- First local commit: `712382574a`
- Current local commit(s): `712382574a`
- Upstream base when introduced: `907b3bc518` (upstream `dev`)
- Last checked against upstream: `907b3bc518` (upstream `dev`)
- Upstream: issue [#53260](https://github.com/anomalyco/opencode/issues/53260), PR [#53261](https://github.com/anomalyco/opencode/pull/53261)

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (effort item 7),
quoting the user:

> likewise MCPs, could show [green]5 [red]2 [yellow]1 something like that;
> minimized, never, or always; + current choice "(5 active)" if minimized
> ('default'?). for my config here: always

## Goals

- `tui.json` `sidebar.mcp_summary`: `"default"` (or unset) keeps upstream's
  `(N active, M errors)` while collapsed; `"collapsed"` shows a colored dot
  and count per status while collapsed; `"always"` shows them collapsed and
  expanded; `"never"` shows no summary.
- Desktop and m4max `~/.config/opencode/tui.json` set `sidebar.mcp_summary`
  to `"always"`.

## Non-goals

- No change to the per-server lines, their dot colors, or when the list can
  be collapsed (more than two servers).

## Rationale and constraints

- Upstream's collapsed summary lumps `failed`, `needs_auth` and
  `needs_client_registration` into "errors", skips `disabled`, and shows
  nothing while expanded.
- Dots reuse `dot()` from the per-server lines (connected success, failed and
  needs client ID error, needs auth warning, disabled muted), so the heading
  reads as a legend; a status with no servers is omitted. Order:
  connected, failed, needs client ID, needs auth, disabled.
- `never` differs from `default` (which shows text while collapsed), so it is
  kept.
- `mcp_summary` is a sibling of `context`, `pin_title`, `order` and `hidden`
  in the shared `Sidebar` struct. Item 6 uses the same literals for
  `sidebar.todo_summary`, minus `default`.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `712382574a` | 2026-10-04 | per-status heading counts, `sidebar.mcp_summary` option, config test, docs line | `View` in `packages/tui/src/feature-plugins/sidebar/mcp.tsx`; `SidebarMcpSummary`/`Sidebar` in `packages/tui/src/config/index.tsx` |

## Verification

- `bun typecheck` and `bun test test/config.test.tsx test/keymap.test.tsx`
  in `packages/tui` - pass on `tui-mcp-summary` and on `dev-nowaker`.
- Manual surface: TUI from source in throwaway tmux socket `oc-tui-mcp`,
  isolated `XDG_*`, fake OpenAI-compatible provider on 127.0.0.1:47962, six
  MCP servers: three stdio servers that connect, one nonexistent command
  (failed), one `enabled: false` (disabled), one remote answering 401 on
  127.0.0.1:47961 (needs auth). Vanilla `907b3bc518`: `▼ MCP` expanded,
  `▶ MCP (3 active, 2 errors)` collapsed. Patched, collapse by mouse click:
  unset/`default` identical to vanilla; `collapsed` gives `▶ MCP •3 •1 •1 •1`
  (green, red, orange, gray) only when collapsed; `always` gives it in both
  states; `never` gives a bare heading. Re-checked `always` on `dev-nowaker`
  with #53217's drag-aware header click.

## Timeline

- 2026-10-04
  [`ses_ef63ef95cffeIfyDzjCjdXqrYc`](../sessions/2026-10-04-sidebar-mcp-summary.md)
  - `712382574a`: introduce; open upstream issue #53260 and PR #53261;
    build and install on desktop and m4max (`vt-85`); `always` set in both
    hosts' `tui.json`.

## Current maintenance notes

- Drop the fork commit once PR #53261 (or an equivalent) is in upstream `dev`.
- On `dev-nowaker` the header text is `selectable={false}` and toggles
  through `onHeaderClick` (from #53217); upstream PR #53261 is written
  against the plain `onMouseDown` header.

### Upstream integration checklist

- Locate the MCP `View` in
  `packages/tui/src/feature-plugins/sidebar/mcp.tsx` and `Sidebar` in
  `packages/tui/src/config/index.tsx`.
- Run `bun typecheck` and `bun test test/config.test.tsx` in `packages/tui`.
- With `sidebar.mcp_summary: "always"`, check the colored counts on the MCP
  heading, expanded and collapsed.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
