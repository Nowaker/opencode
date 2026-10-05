# Keep a completed todo list in the sidebar

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-todo-completed` (off upstream `dev` `907b3bc518`)
- First local commit: `173921d2f3`
- Current local commit(s): `173921d2f3`
- Upstream base when introduced: `907b3bc518` (upstream `dev`)
- Last checked against upstream: `907b3bc518` (upstream `dev`)
- Upstream: no issue or PR. Searched `anomalyco/opencode` issues and PRs
  for todo sidebar visibility on 2026-10-05; the only related item, PR
  #53303 ("propose completed todo visibility toggle"), was a design-only
  draft closed unmerged in favor of #51543 (section order/hide), which does
  not change completed-list visibility.

## Original request

> opencode: sometimes i don't see session's todos in opencode, but vibeterm
> top bar is showing them. why is that? [...] if a patch for that exists,
> check it out, merge and deploy here. treat like it's our own patch.
> otherwise let's just write one ourselves.

> look,i'm not talking about narrow sidebar in opencode.
> i often just don't see any todos.

## Goals

- `tui.json` `sidebar.todo_completed`: `"hide"` (default, upstream
  rendering) removes the Todo section once every item is completed,
  `"collapsed"` keeps the heading with the list collapsed, `"show"` keeps
  the list open.
- Desktop and m4max: `"show"`.

## Non-goals

- No runtime toggle or kv state. The setting comes from config only.

## Rationale and constraints

- Root cause of "Vibeterm shows todos, opencode does not": both read the same
  `todo` table, but the sidebar's `show` memo required at least one item not
  `completed`. A finished list (`6/6`) vanished from the sidebar while the
  Vibeterm top bar kept showing it. A live audit of every Vibeterm tab found
  the Todo heading on every tab with open items and on none with an
  all-completed list.
- `"collapsed"` folds the list on the not-done to done transition (a Solid
  `on(done)` effect) and unfolds it when open work returns; a heading click
  in between still toggles it. The list collapses only past two items, so a
  completed list of two or fewer stays listed.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `173921d2f3` | 2026-10-05 | `todo_completed` option, render tests, config test cases, docs line | `View` in `packages/tui/src/feature-plugins/sidebar/todo.tsx`; `SidebarTodoCompleted` in `Sidebar` in `packages/tui/src/config/index.tsx`; `packages/tui/test/feature-plugins/sidebar-todo.test.tsx` |

## Verification

- `bun typecheck` and `bun test test/config.test.tsx test/feature-plugins/`
  in `packages/tui`: pass on `tui-todo-completed` and on the landing tree
  (38 pass). The four render tests mount the real plugin slot; against the
  unpatched view the three new-behavior tests fail and the default test
  passes.
- Manual surface: TUI from source in throwaway tmux socket
  `oc-tui-todo-done`, isolated `XDG_*`, fake OpenAI-compatible provider on
  127.0.0.1:37681 alternating a `todowrite` of 2 completed / 1 in progress /
  1 pending and one of 4 completed. Unset: list, then no section, then list.
  `collapsed`: list, then `▶ Todo`, then the list reopened. `show`: list,
  then all four `[✓]` items, then list.

## Timeline

- 2026-10-05
  [`ses_ef49a49d9ffeKmNRrjg4DFrQtW`](../sessions/2026-10-05-sidebar-todo-completed.md)
  - `173921d2f3`: introduce; build and install on desktop and m4max; `show`
    set in both hosts' `tui.json`.

## Current maintenance notes

- Merged with `todo_summary` (2026-10-04) in the same `View`: `show` is the
  only memo both features read.

### Upstream integration checklist

- Locate `View` in `sidebar/todo.tsx` and `Sidebar` in
  `packages/tui/src/config/index.tsx`.
- Run `bun typecheck` and `bun test test/config.test.tsx
  test/feature-plugins/` in `packages/tui`.
- With `sidebar.todo_completed: "show"`, finish a todo list and check the
  section stays.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
