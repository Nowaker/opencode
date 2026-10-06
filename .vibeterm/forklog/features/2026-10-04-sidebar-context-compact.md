# Compact sidebar Context display

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-context-display` (off upstream `dev` `907b3bc518`; also the upstream PR head)
- First local commit: `f2fd2979ad`
- Current local commit(s): `f2fd2979ad`, `b433a219dd`
- Upstream base when introduced: `907b3bc518` (upstream `dev`)
- Last checked against upstream: `907b3bc518` (upstream `dev`)
- Upstream: issue [#53200](https://github.com/anomalyco/opencode/issues/53200), PR [#53205](https://github.com/anomalyco/opencode/pull/53205)

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (effort item 4B),
quoting the user:

> allow multiple ways of displaying this:
> Context
> 175,019 tokens
> 17% used
> $1,215.44 spent
> this one is the default, 'default', 'extended', something like that.
>
> another one: 'compact':
> 175,019 tokens [round dot] 17% used [round dot] $1,215.44 spent
> 175,019 [round dot] 17% [round dot] $1,215.44
> 175K [round dot] 17% [round dot] $1,215
> compact responds to available space as right column is dynamic sized.
> setting for m4max and desktop: compact
>
> also, introduce the expand/collapse icon at the extended size, which works
> like expanding/collapsing mcps, switching between default and compact.

## Goals

- `tui.json` `sidebar.context`: `"expanded"` (default, upstream layout) or
  `"compact"`.
- `compact` is one line, picking the most detailed of three variants that
  fits the measured sidebar width.
- ▼/▶ arrow on the Context header (MCP section glyphs) toggles the mode by
  click; palette command `sidebar.context.toggle` (keybind
  `sidebar_context_toggle`, unbound) does the same; the runtime choice is kv
  `sidebar_context` and overrides the config value.
- Desktop and m4max `~/.config/opencode/tui.json` set `sidebar.context` to
  `"compact"`.

## Non-goals

- No change to how tokens, percent, or cost are computed.

## Rationale and constraints

- The Context block spent four sidebar lines on three numbers and, unlike
  MCP/LSP/Modified Files, could not be collapsed.
- `sidebar` is a struct so sibling 4A's `sidebar.pin_title` lands as a
  sibling field in the same `Sidebar` schema.
- Width comes from the block's own `onSizeChange`, not a hard-coded sidebar
  width, so it follows any sidebar resize.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `f2fd2979ad` | 2026-10-04 | expanded/compact Context block, header toggle, palette command, `sidebar.context` option, docs line | `View` in `packages/tui/src/feature-plugins/sidebar/context.tsx`; `Sidebar`/`SidebarContext` in `packages/tui/src/config/index.tsx`; `sidebar_context_toggle` in `packages/tui/src/config/keybind.ts` |
| `b433a219dd` | 2026-10-04 | compact variants joined with ` · ` (U+00B7, the prompt footer separator) instead of ` • ` | `variants` in `View`, `packages/tui/src/feature-plugins/sidebar/context.tsx` |

## Verification

- `bun typecheck` and `bun test test/config.test.tsx test/keymap.test.tsx`
  in `packages/tui` - pass on `tui-context-display` and on `dev-nowaker`.
- Manual surface: `bun run --cwd packages/opencode src/index.ts --pure` in
  throwaway tmux socket `oc-tui-ctx`, isolated `XDG_*` dirs, a fake
  OpenAI-compatible provider on 127.0.0.1 returning 175,019 tokens. Vanilla
  `907b3bc518`: four-line block. Patched: `sidebar.context: "compact"` gives
  `▶ 175,019 · 18% · $1,215.20` at width 42, `▶ 175,019 tokens · 18% used ·
  $1,215.20 spent` at 60, `▶ 175K · 18% · $1,215` at 26 (` · ` since
  `b433a219dd`; captured bytes `c2 b7`); palette and mouse
  toggles switch modes and kv `sidebar_context` persists across restart.

## Timeline

- 2026-10-06 [`ses_eeda1d251ffel81U5Y42j4kb33`](../sessions/fork-audit.md) -
  add renderer width/click/KV/palette/selectability proofs and preserve the
  exceptionally narrow-space limitation in the linked inventory.

- 2026-10-04
  [`ses_ef81b7a80ffeaAyKTHFHlHGXVs`](../sessions/2026-10-04-sidebar-context-compact.md)
  - `f2fd2979ad`: introduce; open upstream issue #53200 and PR #53205;
    build and install on desktop (`vt-73`) and m4max (`vt-74`); `compact`
    set in both hosts' `tui.json`.
- 2026-10-04
  [`ses_ef81ad30fffeo7m3HoZisuJdli`](../sessions/2026-10-04-sidebar-section-order.md)
  - `dc68262b8a`: the Context header toggles through `onHeaderClick` (press
    and release on the same cell) with non-selectable header text, so it
    can be dragged; click toggle re-verified in tmux.
- 2026-10-04
  [`ses_ef6439100ffea6UZ1MqYyvXDjR`](../sessions/2026-10-04-sidebar-context-colors.md)
  - `dc76be7263`: compact variants become three-part arrays rendered as
    spans so tokens, percent and cost can be colored; width selection and
    the ` · ` separator are unchanged; all three variants re-verified in tmux.
- 2026-10-04
  [`ses_ef81b7a80ffeaAyKTHFHlHGXVs`](../sessions/2026-10-04-sidebar-context-compact.md)
  - `b433a219dd`: user asked for the footer's small dot; compact variants
    use ` · ` instead of ` • `, re-verified at widths 26/42/60 in tmux. PR
    #53205 head amended to `7d9790cb1c`. Not built; later items rebuild
    both hosts.
- 2026-10-05
  [`ses_ef81ad30fffeo7m3HoZisuJdli`](../sessions/2026-10-05-sidebar-header-select.md)
  - `1c06f291b3`: the compact line is selectable text again (the user could
    not drag-copy it); its `▶` arrow stays the section drag handle and a
    click on the line still toggles. Re-verified in tmux and on desktop
    `vt-101`.

## Current maintenance notes

- Drop the fork commit once PR #53205 (or an equivalent) is in upstream `dev`.
- If upstream lands 4A's `sidebar` struct first, keep both fields in one
  `Sidebar` schema.

### Upstream integration checklist

- Locate the Context `View` in
  `packages/tui/src/feature-plugins/sidebar/context.tsx` and `Sidebar` in
  `packages/tui/src/config/index.tsx`.
- Run `bun typecheck` and `bun test test/config.test.tsx` in `packages/tui`.
- With `sidebar.context: "compact"`, check the one-line Context block.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
