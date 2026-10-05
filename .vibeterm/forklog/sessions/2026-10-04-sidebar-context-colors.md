# Color sidebar Context usage and cost by thresholds

## Identity

- Workday: 2026-10-04
- Session: `ses_ef6439100ffea6UZ1MqYyvXDjR`
- Agent/platform: `Sisyphus - ultraworker` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-context-colors` (worktree under `.vibeterm/worktrees/`, stacked on `tui-context-display`); landing branch `ctx-colors-land`
- Upstream base: `907b3bc518` (upstream `dev`); unchanged
- Source result commit(s): `dc76be7263` (cherry-pick of `24e25a69cc` on `tui-context-colors`); follow-up `6f6107700b` (mirrors the amended PR commit `94d6044030`)
- Forklog commit: this file's introducing commit

## User requests

Spawned by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` as effort item 5
("opencode TUI improvements"); the verbatim request is in the
[feature record](../features/2026-10-04-sidebar-context-colors.md#original-request).

## Goals

- Optional threshold coloring of the sidebar Context usage and cost; default
  rendering unchanged; colored with default thresholds on desktop and m4max.
- Same change offered upstream, stacked on #53205.

## Constraints and non-goals

- Settings live in the shared `sidebar` struct beside siblings' `pin_title`,
  `context`, `order`, `hidden`, `mcp_summary` and `todo_summary`.
- The compact separator is 4B's ` · `; this session did not change it.
- No TUI tab, service, or vibeterm tmux server restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `faac861ffc` | `dc76be7263` + this forklog commit | cherry-pick onto `ctx-colors-land`, rebase past the item 6 todo-summary and item 7 MCP-summary landings (merged their `Sidebar` fields, tests and docs lines), fast-forward; pushed to `origin` and `nowaker-github` |
| `opencode` (GitHub fork) | `tui-context-colors` | - | `24e25a69cc` | new branch on `tui-context-display`; rebased from `cf42e21f81` onto 4B's amended `7d9790cb1c`; head of PR #53264 |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Color sidebar Context usage and cost by thresholds](../features/2026-10-04-sidebar-context-colors.md) | introduced | typecheck; `levelColor` and config tests; before/after colored tmux frames |
| [Compact sidebar Context display](../features/2026-10-04-sidebar-context-compact.md) | changed (variants rendered as colorable spans) | compact frames at sidebar widths 60/42/26 |

## Other delivered work

- Upstream issue [#53263](https://github.com/anomalyco/opencode/issues/53263)
  and PR [#53264](https://github.com/anomalyco/opencode/pull/53264), opened
  with `~/.local/bin/gh`.

## Verification

- `bun typecheck` in `packages/tui` - exit 0 on both branches;
  `bun test test/feature-plugins/sidebar-context.test.ts
  test/config.test.tsx test/keymap.test.tsx` - 14 pass.
- Manual surface: see the feature record's Verification section; the
  landing tree was re-checked in compact mode at 85% (tokens/% `#e78064`,
  separators and cost muted).

## Build and install

- Build command: `.vibeterm/build.sh` (with `TMPDIR` in the checkout's
  `tmp/`) on desktop at `dc76be7263`, and on m4max after fast-forwarding its
  checkout from `faac861ffc` to `dc76be7263`.
- Installed artifact: desktop `1.18.34-vt-89-907b3bc518` (inode
  `49983451`), m4max `1.18.34-vt-89-907b3bc518`; both binaries contain
  `context_thresholds` and `cost_thresholds`.
- Host setting: `sidebar.context_color: "colored"` added to
  `~/.config/opencode/tui.json` on both hosts by an atomic read-modify-write
  that kept every other key; no threshold keys set. The desktop file decodes
  with `TuiConfig.Info`.
- Running services: none restarted on either host.

## Follow-up: prompt footer coloring

- Coordinator relayed the user (2026-10-05 04:38, still this workday):
  "colored context usage - make those colors also apply to bottom ctx and
  usage indicator and for money threshold there too".
- The prompt footer usage line now uses the same coloring: context by
  `context_thresholds` when colored, cost by `cost_thresholds`, separator
  muted; plain mode unchanged. `levelColor` moved to
  `packages/tui/src/util/usage-color.ts` with `usageColors`, shared by the
  sidebar and the footer. Because the keys now govern two places they moved
  from `sidebar.*` to a top-level `usage` struct with unchanged field names.
- PR branch `tui-context-colors`: feature commit amended `24e25a69cc` ->
  `94d6044030`, force-pushed with lease to `nowaker-github` and `origin`;
  PR #53264 and issue #53263 titles and bodies updated.
- `dev-nowaker`: follow-up commit `6f6107700b` on `f17d9bd206` (not
  force-pushed), rebased past the 4C date-first turn timing and the compact
  MCP rows (`sidebar.mcp_list`) landings; `config.test.tsx` conflict
  resolved as a union.
- Verification: `bun test test/util/usage-color.test.ts test/config.test.tsx
  test/keymap.test.tsx` 15 pass and `bun typecheck` on both branches; tmux
  socket `oc-tui-ctxfoot`, isolated `XDG_*`, fake provider stepping 50k-95k
  of 100k with `cost_thresholds: [1, 2, 3]`: colored footer `#f5a742` /
  `#ee9353` / `#e78064` / `#e06c75`, cost `#f5a742` to `#e06c75`, plain
  footer all `#808080`; landing tree spot-checked at 85% (`#e78064`, cost
  under $1 muted).
- Build and install: desktop `1.18.34-vt-94-907b3bc518` (inode
  `49955973`), m4max `1.18.34-vt-94-907b3bc518` after fast-forwarding its
  checkout to `6f6107700b`.
- Host setting: `sidebar.context_color` removed and
  `usage.context_color: "colored"` added in `~/.config/opencode/tui.json` on
  both hosts by one atomic read-modify-write; every other key kept. The
  desktop file decodes with `TuiConfig.Info`.
- Running services: none restarted on either host.

## Commit provenance

- `dc76be7263` - sidebar context coloring.
- `6f6107700b` - prompt footer coloring and `usage.*` keys.
- Required trailer: `AI-Session-ID: ses_ef6439100ffea6UZ1MqYyvXDjR`

## Unknowns and blocked verification

- None.
