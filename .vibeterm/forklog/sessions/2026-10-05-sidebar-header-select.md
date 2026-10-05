# Keep sidebar header values selectable next to the drag handle

## Identity

- Workday: 2026-10-05
- Session: `ses_ef81ad30fffeo7m3HoZisuJdli`
- Agent/platform: `Sisyphus` (anthropic/claude-opus-5-5, variant max) / linux
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-sidebar-drag` (upstream PR #53217 head, amended), landed via `sidebar-select-fix`
- Upstream base: `907b3bc518` (upstream `dev`, contains `v1.18.34`); unchanged
- Source result commit(s): `937fde86d9` (PR #53217 head), `1c06f291b3` (`dev-nowaker`)
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`:

> icon 234,124 · 40% · $30 - why can't i drag to copy on it? make it
> possible. same for mcps. currently it appears only session name and todos
> are copy-to-drag possible.

## Goals

- Drag-select copies the values on sidebar header lines again: the compact
  Context line, the MCP counts and collapsed summary, and the MCP rows.
- A header click still collapses and expands; a header drag still reorders.

## Constraints and non-goals

- Fix on the introducing branch: amend PR #53217. PR #53201 is unchanged; its
  commit `0406a6a30e` touches no `feature-plugins/sidebar/*` file.
- On `dev-nowaker` a fix commit on top, no force-push, covering the headers
  merged with the drag treatment since: 4B Context, item 6 Todo summary,
  item 7 MCP counts, 4C LSP one-liner.
- No TUI tab, service or vibeterm tmux server restarted.

## Findings

- Cause: `dc68262b8a` made each whole header `<text>` `selectable={false}`
  so a press there starts a section drag. Values merged into those header
  texts later (compact Context line, MCP counts, Todo summary, "are
  disabled") inherited it and could no longer be selected.
- Vanilla `907b3bc518` (tmux, OSC 52 buffer): the Context lines, "LSPs are
  disabled", the `MCP` heading word and the MCP rows all copy. The collapsed
  MCP summary cannot be copied there either: the press that starts the
  selection expands the section and removes the summary.
- Installed `vt-89`: the compact Context line and `MCP •3` copy nothing; MCP
  rows still copy when the drag starts on their text. A drag starting on the
  blank gap after an MCP row's bullet reordered the section instead.

## Design

- In opentui a press on selectable text starts a text selection and never a
  capture drag, so a cell is either the drag handle or copyable text. Only a
  section's name and arrow stay `selectable={false}`; the values after them
  on the header line are their own selectable text. The compact Context row
  has no name, so its `▶` arrow is the handle.
- A drag reorders only when it starts on a section's first line
  (`event.y === this.y` in the `wrap` box's `onMouseDown`), so blank cells in
  a section body never move it.
- Clicking a header value still toggles: toggling needs a press and release
  on the same cell, which a drag-select never is.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` (GitHub fork + GitLab) | `tui-sidebar-drag` | `24d4dd26f5` | `937fde86d9` | amend; force-push with lease to `nowaker-github` and `origin`; PR #53217 body updated |
| `opencode` | `dev-nowaker` | `79251bcdf3` | `1c06f291b3` | fix commit on `sidebar-select-fix`, rebased onto the moving tip; fast-forward; pushed to `origin` and `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Order, hide and drag session sidebar sections](../features/2026-10-04-sidebar-section-order.md) | fixed | `slots.test.tsx` mouse tests, tmux copy and drag checks |
| [Compact sidebar Context display](../features/2026-10-04-sidebar-context-compact.md) | changed | compact line copies, arrow drags, click toggles |
| [Per-status MCP counts in the sidebar heading](../features/2026-10-04-sidebar-mcp-summary.md) | changed | `•3` and the collapsed summary copy |
| [Todo counts after the sidebar Todo heading](../features/2026-10-04-sidebar-todo-summary.md) | changed | `1+1/3` copies, click toggles |
| [One-line "LSPs are disabled" in the sidebar](../features/2026-10-04-sidebar-lsp-disabled-oneline.md) | changed | `are disabled` copies |

## Other delivered work

- PR [#53217](https://github.com/anomalyco/opencode/pull/53217) description
  explains the handle design and the new checks.

## Verification

- `bun typecheck` in `packages/tui` and `packages/opencode` - exit 0 on
  `tui-sidebar-drag` and on `dev-nowaker`.
- `packages/tui` `bun test test/plugin test/feature-plugins test/config.test.tsx`
  on `1c06f291b3` - 52 pass, 0 fail. Before the fix the new body-drag and
  collapsed-summary tests failed (9 pass, 2 fail on `24d4dd26f5`).
- Full `packages/tui` `bun test` on the fix - 239 pass, 4 fail:
  `app-lifecycle.test.tsx` (2) fails the same way on `ec4a7c7017` without the
  fix; `diff-viewer-file-tree.test.tsx` (1-2) passes on rerun at load ~150.
- Manual surface: throwaway tmux socket `oc-tui-selfix`, isolated XDG dirs,
  a fake OpenAI-compatible provider that also writes a todo list, 3 failing
  MCP servers, `tui.json` `{"sidebar":{"context":"compact","mcp_summary":"always","todo_summary":"always"}}`,
  copy read from tmux's OSC 52 buffer and the "Copied to clipboard" toast.
  Compact Context `234,124 · 40`, `•3`, `1+1/3`, `are disabled` and an MCP row
  copy with the order untouched; clicks on the `MCP` name, the compact
  Context line, the `Context` name and the Todo summary toggle; dragging the
  `MCP` name onto Context and the compact Context arrow onto Todo reorder
  (kv `sidebar_order` `["mcp","lsp","todo","context","files"]`); a drag from
  the gap after an MCP row's bullet does not.
- Installed desktop `1.18.34-vt-101-907b3bc518`: compact Context and `•3`
  copy, a click on `MCP` collapses it.

## Build and install

- Build command: `.vibeterm/build.sh` on each host, `TMPDIR` under the
  checkout's `tmp/`.
- Desktop: `1.18.34-vt-101-907b3bc518` built from `0502c8284f`
  (`1c06f291b3` plus a forklog-only commit); installed at
  `~/projekty/webapps/opencode-build/bin/opencode` (inode `49956025`).
- m4max: `1.18.34-vt-100-907b3bc518` built from `1c06f291b3`.
- Running services: not restarted.

## Commit provenance

- `1c06f291b3` - fix commit on `dev-nowaker`.
- `937fde86d9` - amended PR #53217 head (not on `dev-nowaker`).
- Required trailer: `AI-Session-ID: ses_ef81ad30fffeo7m3HoZisuJdli`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-05-sidebar-header-select.md
```

## Unknowns and blocked verification

- The first desktop build, launched in the background, died in `vite build`
  with SIGHUP; the cause was not investigated. A foreground rerun succeeded.
