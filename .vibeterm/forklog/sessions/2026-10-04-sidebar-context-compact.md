# Compact sidebar Context display

## Identity

- Workday: 2026-10-04
- Session: `ses_ef81b7a80ffeaAyKTHFHlHGXVs`
- Agent/platform: `Sisyphus - ultraworker` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-context-display` (worktree under `.vibeterm/worktrees/`, off upstream `dev` `907b3bc518`); landing branch `ctx-land`
- Upstream base: `907b3bc518` (upstream `dev`); unchanged
- Source result commit(s): `f2fd2979ad` (cherry-pick of `cf42e21f81` on `tui-context-display`)
- Forklog commit: this file's introducing commit

## User requests

Spawned by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` as effort item 4B
("opencode TUI improvements"); the verbatim request is in the
[feature record](../features/2026-10-04-sidebar-context-compact.md#original-request).

## Goals

- Expanded/compact sidebar Context display with a header toggle and a
  `tui.json` default; compact on desktop and m4max.
- Same change offered upstream.

## Constraints and non-goals

- Diff kept to `context.tsx`, the config schema, and keybind entries because
  sibling sessions 4A, 4C and 4D edit the same sidebar.
- `sidebar.context` shares 4A's `sidebar` struct, as agreed with
  `ses_ef81bccccffeaNpV0Vw2TPKgyP`.
- No TUI tab or vibeterm tmux server restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `c4cff78b67` | `f2fd2979ad` + this forklog commit | cherry-pick onto `ctx-land`, rebase past the 4A pin-title and item 3 turn-timing landings (merged `sidebar.pin_title` and `sidebar.context` into one `Sidebar` struct), fast-forward; pushed to `origin` and `nowaker-github` |
| `opencode` (GitHub fork) | `tui-context-display` | - | `cf42e21f81` | new branch off upstream `dev` `907b3bc518`; head of PR #53205 |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Compact sidebar Context display](../features/2026-10-04-sidebar-context-compact.md) | introduced | typecheck; config/keymap tests; before/after tmux frames |

## Other delivered work

- Upstream issue [#53200](https://github.com/anomalyco/opencode/issues/53200)
  (issue-first policy) and PR
  [#53205](https://github.com/anomalyco/opencode/pull/53205), opened through
  the GitHub REST API because `gh` is not installed on desktop.

## Verification

- `bun typecheck` in `packages/tui` - exit 0 on both branches;
  `bun test test/config.test.tsx test/keymap.test.tsx` - 11 pass.
- Manual surface: see the feature record's Verification section (tmux socket
  `oc-tui-ctx`, isolated `XDG_*`, fake provider on 127.0.0.1:47934).

## Build and install

- Build command: `.vibeterm/build.sh` (with `TMPDIR` in the checkout's `tmp/`)
  on desktop at `8bbc3300a4`, and on m4max after fast-forwarding its checkout
  from `c4cff78b67`; another session fast-forwarded the m4max checkout to
  `ee0a8c04e5` (forklog-only on top of `8bbc3300a4`) before the stamp was
  taken.
- Installed artifact: desktop `1.18.34-vt-73-907b3bc518` (inode `49955445`),
  m4max `1.18.34-vt-74-907b3bc518`; both binaries contain
  `sidebar_context` and "Compact sidebar context".
- Host setting: `sidebar.context: "compact"` added to
  `~/.config/opencode/tui.json` on both hosts by an atomic read-modify-write
  that kept every other key (including 4A's `sidebar.pin_title`); the
  desktop file decodes with `TuiConfig.Info`.
- Running services: none restarted on either host.

## Commit provenance

- `f2fd2979ad` - sidebar change.
- Required trailer: `AI-Session-ID: ses_ef81b7a80ffeaAyKTHFHlHGXVs`

## Unknowns and blocked verification

- None.
