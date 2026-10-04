# Order, hide and drag session sidebar sections

## Identity

- Workday: 2026-10-04
- Session: `ses_ef81ad30fffeo7m3HoZisuJdli`
- Agent/platform: `Sisyphus` (anthropic/claude-opus-5-5) / linux
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-sidebar-order`, `tui-sidebar-drag`, landed via `land-sidebar-order`
- Upstream base: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Source result commit(s): `0406a6a30e`, `24d4dd26f5` (upstream PR heads); `bc5aa4ec1e`, `dc68262b8a` (`dev-nowaker`)
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (effort item 4D):

> allow reordering and hiding of elements in that menu (except for title) via
> tui config. and maybe also drag and drop? <- as a separate PR on top of the
> first one, since this may be controversial.

## Goals

- PR 1: `tui.json` `sidebar.order` / `sidebar.hidden`, plugin sections
  included, unlisted sections kept in default order.
- PR 2 (stacked): mouse drag-and-drop reorder persisted in kv, click to
  collapse preserved.

## Constraints and non-goals

- Siblings 4A, 4B and 4C edit the same sidebar; settings share the `sidebar`
  struct per 4A's request.
- No restart of TUI tabs, the vibeterm tmux server or serve units.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` (GitHub fork + GitLab) | `tui-sidebar-order` | - | `0406a6a30e` | new branch off upstream `dev` `907b3bc518`; head of PR #53201 |
| `opencode` (GitHub fork + GitLab) | `tui-sidebar-drag` | - | `24d4dd26f5` | stacked on `tui-sidebar-order`; head of PR #53217; force-pushed with lease from `ad25bdd00f` to fix header toggling on drop |
| `opencode` | `dev-nowaker` | `6ff168d896` | `dc68262b8a` | cherry-pick both; conflicts with 4A/4B/4C resolved by keeping both sides (one `Sidebar` struct, both commands, 4C's LSP heading, 4B's Context header given the drag header treatment); fast-forward; pushed to `origin` and `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Order, hide and drag session sidebar sections](../features/2026-10-04-sidebar-section-order.md) | introduced | typecheck, tests, tmux captures |
| [Compact sidebar Context display](../features/2026-10-04-sidebar-context-compact.md) | re-verified | its header toggles on click, not on drag or drop |

## Other delivered work

- Upstream issue [#53198](https://github.com/anomalyco/opencode/issues/53198),
  PRs [#53201](https://github.com/anomalyco/opencode/pull/53201) and
  [#53217](https://github.com/anomalyco/opencode/pull/53217); #53201 has a
  comment linking the follow-up.

## Verification

- See the feature record. `packages/tui` `bun test` on `dev-nowaker`:
  225 pass, 0 fail; typecheck exit 0 in `packages/tui` and `packages/opencode`.
- `grep -c session.sidebar.reset_order` on both installed binaries - 1.

## Build and install

- Build command: `.vibeterm/build.sh` on each host, `TMPDIR` under the
  checkout's `tmp/` (desktop `/tmp` was near its quota).
- Desktop: `1.18.34-vt-80-907b3bc518` built from `dc68262b8a`; installed at
  `~/projekty/webapps/opencode-build/bin/opencode` (inode `49955452`).
- m4max: `1.18.34-vt-80-907b3bc518` built from `dc68262b8a`.
- Running services: not restarted.

## Commit provenance

- `bc5aa4ec1e`, `dc68262b8a` - feature commits on `dev-nowaker`.
- Required trailer: `AI-Session-ID: ses_ef81ad30fffeo7m3HoZisuJdli`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-04-sidebar-section-order.md
```

## Unknowns and blocked verification

- With the compiled binary, `opencode <dir> -c` in the isolated rig opened the
  home screen instead of resuming; the installed check used a new session.
  Not investigated; unrelated to this feature.
