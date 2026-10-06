# Todo counts after the sidebar Todo heading

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-todo-summary` (off upstream `dev` `907b3bc518`; also the upstream PR head)
- First local commit: `5c5fc747e0`
- Current local commit(s): `5c5fc747e0`
- Upstream base when introduced: `907b3bc518` (upstream `dev`)
- Last checked against upstream: `907b3bc518` (upstream `dev`)
- Upstream: issue [#53258](https://github.com/anomalyco/opencode/issues/53258), PR [#53259](https://github.com/anomalyco/opencode/pull/53259)

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (effort item 6),
quoting the user:

> todos - in title, optionally, show it in normal color after Todo title, like
> we show in vibeterm top bar, e.g. 10+1/12, and other option could be
> [tickmark]12 [in progress icon]2 [done icon]16. and option to show it if
> minimized, never, or always. for my config here: always

## Goals

- `tui.json` `sidebar.todo_summary`: `"never"` (default, upstream rendering),
  `"collapsed"` (only while the list is collapsed), or `"always"`.
- `sidebar.todo_summary_style`: `"progress"` (default) is
  completed+in_progress/total (`10+1/12`, `+0` dropped), the same format as
  Vibeterm's top bar (`formatTodoProgress` in opencode-tools
  `_lib/session-todo/index.ts`); `"icons"` is `✓10 •1 ○1`, with zero counts
  skipped. `✓`/`•` are `TodoItem`'s glyphs, and `○` is the TUI's "off" marker
  from `dialog-mcp`.
- The summary uses the theme's normal text color, not bold.
- Desktop and m4max: `todo_summary: "always"`, style `"progress"`.

## Non-goals

- No runtime toggle or kv state. The setting comes from config only.

## Rationale and constraints

- A collapsed Todo section showed only `▶ Todo`, with no progress.
- Vanilla collapses the list only past two items (`list().length > 2`), so
  `collapsed` never shows a summary on a shorter list, which is fully visible
  anyway. Kept the option rather than dropping it.
- Keys sit beside `context`, `pin_title`, `order` and `hidden` in the shared
  `Sidebar` struct; sibling item 7 uses the matching `sidebar.mcp_summary`.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `5c5fc747e0` | 2026-10-04 | summary after the Todo heading, two config keys, formatter unit test, docs line | `View` and exported `todoSummary` in `packages/tui/src/feature-plugins/sidebar/todo.tsx`; `SidebarTodoSummary`/`SidebarTodoSummaryStyle` in `Sidebar` in `packages/tui/src/config/index.tsx` |

## Verification

- `bun typecheck` and `bun test test/config.test.tsx
  test/feature-plugins/sidebar-todo.test.ts` in `packages/tui`: pass on
  `tui-todo-summary` and on the landing branch (plus `test/keymap.test.tsx`).
- Manual surface: TUI from source in throwaway tmux socket `oc-tui-todo`,
  isolated `XDG_*`, fake OpenAI-compatible provider on 127.0.0.1 answering
  with a `todowrite` (10 completed, 1 in progress, 1 pending). Default: `▼
  Todo` / `▶ Todo` as vanilla. `always`: `▼ Todo 10+1/12` open and
  collapsed. `always` + `icons`: `✓10 •1 ○1`. `collapsed` + `icons`: nothing
  open, `✓10 •1 ○1` collapsed. The ANSI capture shows the counts in theme text
  `#eeeeee` without bold. Re-checked on the landing tree, where the header
  click goes through 4D's `onHeaderClick`.

## Timeline

- 2026-10-06 [`ses_eeda1d251ffel81U5Y42j4kb33`](../sessions/fork-audit.md) -
  verify formatter, rendered headings and selection; cancelled-task and collapse
  semantics remain explicitly recorded in the linked inventory.

- 2026-10-04
  [`ses_ef6415913ffeq4hyR0MCqsjDsn`](../sessions/2026-10-04-sidebar-todo-summary.md)
  - `5c5fc747e0`: introduce; open upstream issue #53258 and PR #53259; build
    and install on desktop and m4max; `always` set in both hosts' `tui.json`.
- 2026-10-05
  [`ses_ef49a49d9ffeKmNRrjg4DFrQtW`](../sessions/2026-10-05-sidebar-todo-completed.md)
  - Preserved: merged with `sidebar.todo_completed` in the same `View`.
- 2026-10-05
  [`ses_ef81ad30fffeo7m3HoZisuJdli`](../sessions/2026-10-05-sidebar-header-select.md)
  - `1c06f291b3`: the summary moves out of the non-selectable `Todo` text
    into its own text, so it copies on drag-select (`1+1/3`); rendering
    unchanged.

## Current maintenance notes

- Drop the fork commit once PR #53259 (or an equivalent) is in upstream `dev`.
- On `dev-nowaker`, the Todo header keeps 4D's `onHeaderClick` and
  `selectable={false}`; the summary is a `<span>` inside the heading `<text>`.

### Upstream integration checklist

- Locate `View`/`todoSummary` in `sidebar/todo.tsx` and `Sidebar` in
  `packages/tui/src/config/index.tsx`.
- Run `bun typecheck` and `bun test test/config.test.tsx
  test/feature-plugins/sidebar-todo.test.ts` in `packages/tui`.
- With `sidebar.todo_summary: "always"`, check `Todo 10+1/12`-style heading.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
