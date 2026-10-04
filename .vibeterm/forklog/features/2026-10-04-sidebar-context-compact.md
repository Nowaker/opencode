# Compact sidebar Context display

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-context-display` (off upstream `dev` `907b3bc518`; also the upstream PR head)
- First local commit: `f2fd2979ad`
- Current local commit(s): `f2fd2979ad`
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

## Verification

- `bun typecheck` and `bun test test/config.test.tsx test/keymap.test.tsx`
  in `packages/tui` - pass on `tui-context-display` and on `dev-nowaker`.
- Manual surface: `bun run --cwd packages/opencode src/index.ts --pure` in
  throwaway tmux socket `oc-tui-ctx`, isolated `XDG_*` dirs, a fake
  OpenAI-compatible provider on 127.0.0.1 returning 175,019 tokens. Vanilla
  `907b3bc518`: four-line block. Patched: `sidebar.context: "compact"` gives
  `▶ 175,019 • 18% • $1,215.20` at width 42, `▶ 175,019 tokens • 18% used •
  $1,215.20 spent` at 60, `▶ 175K • 18% • $1,215` at 26; palette and mouse
  toggles switch modes and kv `sidebar_context` persists across restart.

## Timeline

- 2026-10-04
  [`ses_ef81b7a80ffeaAyKTHFHlHGXVs`](../sessions/2026-10-04-sidebar-context-compact.md)
  - `f2fd2979ad`: introduce; open upstream issue #53200 and PR #53205.

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
