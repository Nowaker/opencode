# Pin the session title at the top of the sidebar

## Identity

- Workday: 2026-10-04
- Session: `ses_ef81bccccffeaNpV0Vw2TPKgyP`
- Agent/platform: `Sisyphus` (anthropic/claude-opus-5-5) / linux
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-sidebar-pin-title`, landed via `tui-sidebar-pin-title-land`
- Upstream base: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Source result commit(s): `d18d01064f` (upstream PR head), `6ece456497` (`dev-nowaker`)
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (effort item 4A):

> right sidebar improvements: session title area: allow to pin the title to
> the top, so scroll doesn't hide it. remember to handle the scrollbars
> correctly, it shouldn't show on the session title level.

## Goals

- A `tui.json` option and runtime toggle that pin the sidebar title outside
  the scrollable region, default unpinned; pinned ON on desktop and m4max.

## Constraints and non-goals

- Sibling sessions 4B, 4C and 4D edit the same sidebar; the diff stays in the
  title block, the config struct and one command.
- No restart of TUI tabs, the vibeterm tmux server or serve units.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` (GitHub fork) | `tui-sidebar-pin-title` | - | `d18d01064f` | new branch off upstream `dev` `907b3bc518`; head of PR #53194 |
| `opencode` | `dev-nowaker` | `c38d9305bc` | `6ece456497` | cherry-pick, `tui.mdx` conflict with `keep_scroll_on_submit` resolved by keeping both lines; fast-forward; pushed to `origin` and `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Pin the session title at the top of the sidebar](../features/2026-10-04-sidebar-pin-title.md) | introduced | typecheck, config test, tmux captures |

## Other delivered work

- Upstream issue [#53193](https://github.com/anomalyco/opencode/issues/53193)
  and PR [#53194](https://github.com/anomalyco/opencode/pull/53194).
- `~/.config/opencode/tui.json` on desktop and m4max: added
  `"sidebar": { "pin_title": true }` by atomic read-modify-write; both files
  re-parsed with every other key intact.

## Verification

- `bun typecheck` in `packages/tui` - exit 0 (upstream branch and
  `dev-nowaker`); `bun test test/config.test.tsx` - 9 pass, 0 fail.
- Manual surface: see the feature record (vanilla repro, toggle, `tui.json`).
- `grep -c session.sidebar.pin_title` on both installed binaries - 2.

## Build and install

- Build command: `.vibeterm/build.sh` on each host, `TMPDIR` under the
  checkout's `tmp/`.
- Desktop: `1.18.34-vt-67-907b3bc518` built from `6ece456497`; installed at
  `~/projekty/webapps/opencode-build/bin/opencode` (inode `49955442`).
- m4max: `1.18.34-vt-68-907b3bc518` built from `35bba9112a` (contains
  `6ece456497` plus a forklog-only commit).
- Running services: not restarted.

## Commit provenance

- `6ece456497` - feature commit on `dev-nowaker`.
- Required trailer: `AI-Session-ID: ses_ef81bccccffeaNpV0Vw2TPKgyP`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-04-sidebar-pin-title.md
```

## Unknowns and blocked verification

- `gh` is not installed on desktop and is logged out on m4max; the issue and
  PR were opened through the GitHub REST API with the desktop gh token.
