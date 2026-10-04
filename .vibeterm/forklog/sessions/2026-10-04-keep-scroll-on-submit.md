# Keep the scroll position when a prompt is submitted

## Identity

- Workday: 2026-10-04
- Session: `ses_ef81c7229ffeqHzmyR9O4v0AMH`
- Agent/platform: `Sisyphus - ultraworker` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-submit-scroll` (worktree under `.vibeterm/worktrees/`, off upstream `dev` `907b3bc518`)
- Upstream base: `907b3bc518` (upstream `dev`, contains `v1.18.34`); unchanged
- Source result commit(s): `defa72ee22` (cherry-pick of `332f93dca4` on `tui-submit-scroll`)
- Forklog commit: this file's introducing commit

## User requests

Spawned by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 2 of "opencode
TUI improvements"), quoting the user:

> submitting a prompt scrolls me immediately back down. in vibeterm, system
> prompts arrive in tuis so this is disruptive. this should be a tui setting,
> default off, here and m4max: on, and modifiable in runtime like other things
> like /timestamps.

## Goals

- Opt-in TUI setting plus runtime toggle; upstream issue and PR; land on
  `dev-nowaker`; build both hosts; turn it on in both hosts' `tui.json`.

## Constraints and non-goals

- AI-output auto-scroll while scrolled up is item 1, another session.
- No TUI tab, vibeterm tmux server or `opencode-serve-*` unit restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` (GitHub fork) | `tui-submit-scroll` | - | `332f93dca4` | new branch off upstream `dev` `907b3bc518`; head of PR #53187 |
| `opencode` | `dev-nowaker` | `440ff5e133` | `defa72ee22` | cherry-pick, fast-forward; pushed to `origin` and `nowaker-github` |
| `opencode` (m4max) | `dev-nowaker` | `440ff5e133` | `defa72ee22` | fast-forward from `origin` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Keep the scroll position when a prompt is submitted](../features/2026-10-04-keep-scroll-on-submit.md) | introduced | config test; isolated TUI before/after frames |

## Other delivered work

- Upstream issue [#53186](https://github.com/anomalyco/opencode/issues/53186)
  (no existing issue found for "scroll position submit", "auto scroll
  submit", "jumps to bottom", "scrolled up prompt") and PR
  [#53187](https://github.com/anomalyco/opencode/pull/53187).
- `"keep_scroll_on_submit": true` added to `~/.config/opencode/tui.json` on
  desktop and m4max by an atomic read-modify-write of that one key; both
  files re-parse.

## Verification

- `bun test test/config.test.tsx` (9 pass) and `bun typecheck` in
  `packages/tui` on `tui-submit-scroll` and on the `dev-nowaker` cherry-pick.
- Manual surface: TUI from source, isolated XDG dirs, tmux socket
  `oc-tui-submit-scroll`, local OpenAI-compatible fake server streaming 80
  lines. Scroll up 3 pages and submit:
  - vanilla `dev`: before `reply line 44 to first prompt`, after the view
    shows the new prompt and its reply;
  - branch default: same jump;
  - `/keep-scroll` on: `reply line 44 to third default` before, 1 s after,
    and after the reply finished;
  - `/keep-scroll` on at the bottom: reply followed (`line 29` mid-stream,
    `line 80` at the end);
  - `tui.json` `true`, no kv key: view stays, palette offers "Scroll to
    bottom on submit", `kv.json` unchanged.

## Build and install

- Build command: `.vibeterm/build.sh` in each host's primary checkout.
- Installed artifact: desktop `1.18.34-vt-65-907b3bc518` (built at
  `734f174eb0`, which the reintegration session's forklog commit moved the
  tip to mid-build), inode `49955441`; m4max `1.18.34-vt-64-907b3bc518`
  (built at `defa72ee22`). Both binaries contain `keep_scroll_on_submit`
  and the retry-header marker.
- Running services: none restarted on either host; running TUIs pick up the
  build and `tui.json` only after their own restart.

## Commit provenance

- `defa72ee22` - setting, toggle, test and docs.
- Required trailer: `AI-Session-ID: ses_ef81c7229ffeqHzmyR9O4v0AMH`

## Unknowns and blocked verification

- The installed binaries were not driven in a TUI; the source build was.
