# Pin the session title at the top of the sidebar

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-sidebar-pin-title` (off upstream `dev` `907b3bc518`; also the upstream PR head)
- First local commit: `6ece456497`
- Current local commit(s): `6ece456497`
- Upstream base when introduced: `907b3bc518` (upstream `dev`)
- Last checked against upstream: `907b3bc518` (upstream `dev`)
- Upstream: issue [#53193](https://github.com/anomalyco/opencode/issues/53193), PR [#53194](https://github.com/anomalyco/opencode/pull/53194)

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (effort item 4A),
quoting the user:

> right sidebar improvements: session title area: allow to pin the title to
> the top, so scroll doesn't hide it. remember to handle the scrollbars
> correctly, it shouldn't show on the session title level.

## Goals

- With `sidebar.pin_title: true` in `tui.json`, or after `/pin-title`, the
  session title block stays at the top of the sidebar while the rest scrolls.
- The sidebar scrollbar starts below the title, never beside it.

## Non-goals

- The default stays upstream's (unpinned).
- The `sidebar_content` slot, the footer and the `feature-plugins/sidebar/*`
  sections are untouched.

## Rationale and constraints

- On upstream `dev` a long sidebar (many MCP servers, LSPs, todos, files)
  scrolls the title out of view; the scrollbar track starts at the top row.
- When pinned, the same `sidebar_title` slot renders above the `<scrollbox>`
  instead of inside it, so plugins overriding the slot are pinned too.
- Upstream `v2` already keeps the heading above the scrollable details
  unconditionally (PR #46449, `197d28e033`); the `dev` PR offers to drop the
  option in favor of that.
- `tui.json` key is a `sidebar` struct so sibling sidebar settings (4B, 4D)
  can share it.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `6ece456497` | 2026-10-04 | `sidebar.pin_title` schema field; `pinned()` reads kv `sidebar_pin_title` falling back to the config; title slot moved above the scrollbox when pinned; `/pin-title` command `session.sidebar.pin_title`, keybind `sidebar_pin_title` | `Sidebar` in `packages/tui/src/routes/session/sidebar.tsx`; `TuiConfig.Sidebar` in `packages/tui/src/config/index.tsx` |

## Verification

- `bun typecheck` in `packages/tui` - exit 0 on `tui-sidebar-pin-title` and on
  `dev-nowaker`; `bun test test/config.test.tsx` - 9 pass.
- Manual surface: 160x40 throwaway tmux socket, isolated XDG dirs, a local
  fake OpenAI-compatible provider and 30 MCP servers so the sidebar scrolls.
  Upstream `907b3bc518`: after wheel-scrolling the sidebar the title is gone
  and the scrollbar track begins at the top row. This build: default
  unchanged; `/pin-title` keeps the title on top with the scrollbar below it
  and persists `sidebar_pin_title: true` in kv; `/pin-title` again restores
  the old layout; `tui.json` `sidebar.pin_title: true` alone pins it.
- Installed desktop binary `1.18.34-vt-67-907b3bc518`: same pinned result
  from `tui.json` in the isolated rig.

## Timeline

- 2026-10-04
  [`ses_ef81bccccffeaNpV0Vw2TPKgyP`](../sessions/2026-10-04-sidebar-pin-title.md)
  - `6ece456497`: introduce; open upstream issue #53193 and PR #53194;
  enable on desktop and m4max.

## Current maintenance notes

- Drop the fork commit once PR #53194 (or an equivalent) is in upstream `dev`.
- Host setting: `"sidebar": { "pin_title": true }` in
  `~/.config/opencode/tui.json` on desktop and m4max.

### Upstream integration checklist

- Locate the `sidebar_title` slot and the `<scrollbox>` in
  `packages/tui/src/routes/session/sidebar.tsx`.
- Run `bun typecheck` and `bun test test/config.test.tsx` in `packages/tui`.
- With a scrolling sidebar and `pin_title` on, check the title stays and the
  scrollbar starts below it.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
