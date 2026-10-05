# Order, hide and drag session sidebar sections

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-sidebar-order` (config, off upstream `dev` `907b3bc518`), `tui-sidebar-drag` (drag-and-drop, stacked on it); both are upstream PR heads
- First local commit: `bc5aa4ec1e`
- Current local commit(s): `bc5aa4ec1e`, `dc68262b8a`, `1c06f291b3`
- Upstream base when introduced: `907b3bc518` (upstream `dev`)
- Last checked against upstream: `907b3bc518` (upstream `dev`)
- Upstream: issue [#53198](https://github.com/anomalyco/opencode/issues/53198), PR [#53201](https://github.com/anomalyco/opencode/pull/53201) (config), PR [#53217](https://github.com/anomalyco/opencode/pull/53217) (drag-and-drop, builds on #53201)

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (effort item 4D),
quoting the user:

> allow reordering and hiding of elements in that menu (except for title) via
> tui config. and maybe also drag and drop? <- as a separate PR on top of the
> first one, since this may be controversial.

## Goals

- `sidebar.order` lists sidebar sections in display order; unlisted sections
  follow in their default order, so a future section never vanishes.
- `sidebar.hidden` hides sections. Names: `context`, `mcp`, `lsp`, `todo`,
  `files`, or a plugin's slot registration id, so plugin sections work too.
- Dragging a section by its header onto another moves it there; the order is
  saved in kv `sidebar_order`, wins over `sidebar.order`, and is cleared by
  "Reset sidebar order" (`session.sidebar.reset_order`).

## Non-goals

- The session title (`sidebar_title` slot) and the footer are not sections.
- No change without config or a drag.

## Rationale and constraints

- opentui slot order belongs to a whole registration, so the host splits a
  registration's `sidebar_content` into its own registration and leaves its
  other slots (e.g. `sidebar_footer`) in place.
- Each section is wrapped in a host box that is `visible={false}` while the
  section renders nothing, so empty Todo/Files take no space.
- opentui captures the renderable under the pointer at the first drag event,
  which can be a gap; the dragged section is the one pressed on mouse down and
  a drag is recognized from `over` events carrying a `source`.
- A press on selectable text starts a text selection, never a drag, so a
  cell is either the drag handle or copyable text. Only the section name and
  its arrow are `selectable={false}`; values after them on the header line
  (compact Context, MCP summary and counts, Todo summary, "are disabled") are
  their own selectable text. A drag reorders only when it starts on the
  section's first line, so a blank cell lower down (the gap after an MCP
  row's bullet) never moves the section.
- Collapsible headers (MCP, LSP, Todo, Files, and 4B's Context) toggle only
  when pressed and released on the same cell (`feature-plugins/sidebar/click.ts`),
  so a drag or a drop onto a header does not toggle it.
- Shares the `sidebar` `tui.json` struct with 4A (`pin_title`) and 4B
  (`context`).

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `bc5aa4ec1e` | 2026-10-04 | `sidebar.order` / `sidebar.hidden`; `placeSidebarSection` applied in slot registration; config passed via `setupSlots(api, config.sidebar)` | `createSlots` in `packages/tui/src/plugin/slots.tsx`; `TuiConfig.Sidebar`; `load()` in `packages/opencode/src/plugin/tui/runtime.ts` |
| `dc68262b8a` | 2026-10-04 | drag-and-drop wrapper, kv `sidebar_order`, live `registry.updateOrder`, reset command, non-selectable headers, `onHeaderClick` | `packages/tui/src/plugin/slots.tsx`; `packages/tui/src/feature-plugins/sidebar/*.tsx`; `routes/session/index.tsx` command list |
| `1c06f291b3` | 2026-10-05 | header values split out of the non-selectable name text so they copy again; a drag starts only on a section's first line | `onMouseDown` of the `wrap` box in `packages/tui/src/plugin/slots.tsx`; header rows in `feature-plugins/sidebar/{context,mcp,todo,lsp}.tsx` |

## Verification

- `bun typecheck` in `packages/tui` and `packages/opencode` - exit 0 on both
  upstream branches and on `dev-nowaker`; `packages/tui` `bun test` on
  `dev-nowaker` - 225 pass, 0 fail.
- Pre-existing, unrelated: 4-5 failures in `packages/opencode`
  `test/config/tui.test.ts` + `test/cli/tui/plugin-loader.test.ts`, identical on
  vanilla `907b3bc518`.
- Manual surface (throwaway tmux socket `oc-tui-sidebar-order`, isolated XDG,
  fake OpenAI-compatible provider, 3 failing MCP servers): vanilla ignores
  `{"sidebar":{"order":["mcp","context"],"hidden":["lsp"]}}`; this build shows
  MCP, Context, no LSP. Drag MCP onto Context and back, drag down, text-select
  drag (no reorder), restart persistence, reset, click collapse/expand, drop on
  a header without toggling it, 4B's compact Context toggle.
- Installed desktop binary `1.18.34-vt-80-907b3bc518` with
  `{"order":["lsp"],"hidden":["context"]}`: LSP first, Context hidden, MCP next.
- 2026-10-05 fix: `slots.test.tsx` drives the real slot host with `mockMouse`
  (header drag reorders, drag from a cell below the header does not, values
  after a name select, the real MCP section's collapsed summary selects and
  still toggles). In tmux, copy-on-select via the OSC 52 buffer: compact
  Context `234,124 · 40`, MCP `•3`, Todo `1+1/3`, `are disabled`, MCP rows
  copy; clicks on names and values toggle; dragging the `MCP` name or the
  compact Context arrow reorders; a drag from a row gap does not. Same copy
  and click result on the installed desktop `1.18.34-vt-101-907b3bc518`.

## Timeline

- 2026-10-04
  [`ses_ef81ad30fffeo7m3HoZisuJdli`](../sessions/2026-10-04-sidebar-section-order.md)
  - `bc5aa4ec1e`, `dc68262b8a`: introduce; issue #53198, PRs #53201 and
    #53217; build and install on desktop and m4max.
- 2026-10-05
  [`ses_ef81ad30fffeo7m3HoZisuJdli`](../sessions/2026-10-05-sidebar-header-select.md)
  - `1c06f291b3`: user could not drag-select the compact Context line or
    the MCP counts; only names and arrows stay the drag handle now, and a
    drag starts only on a section's first line. PR #53217 head amended to
    `937fde86d9`. Build and install on desktop and m4max.

## Current maintenance notes

- Drop the fork commits once #53201 / #53217 (or equivalents) land upstream.
- No host setting; the user has not asked for a specific order.

### Upstream integration checklist

- `placeSidebarSection` and the `register` wrapper in
  `packages/tui/src/plugin/slots.tsx` still see every `sidebar_content`
  registration; `setupSlots` still receives `config.sidebar`.
- Run `bun typecheck` and `bun test test/plugin test/config.test.tsx` in
  `packages/tui`.
- In a TUI: configured order applies, a header drag reorders, a click still
  collapses, and the values after a header name (compact Context, MCP
  counts) still copy on drag-select.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
