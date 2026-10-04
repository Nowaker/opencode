# Keep a scrolled-up reader's place in a long session

## Identity

- Workday: 2026-10-04
- Session: `ses_ef81ca107ffet5DwnFLaGWlUap`
- Agent/platform: `Sisyphus - ultraworker` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `fix-scroll-follow` (worktree under `.vibeterm/worktrees/`, off upstream `dev` `907b3bc518`)
- Upstream base: `907b3bc518` (upstream `dev`, contains `v1.18.34`); unchanged
- Source result commit(s): `6ff168d896` (cherry-pick of `ecfa7cb318` on `fix-scroll-follow`)
- Forklog commit: this file's introducing commit

## User requests

Spawned by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 1 of "opencode
TUI improvements"), quoting the user:

> when i scroll up in chat log, and stay there, so i can read, ai activity
> constantly interrupts me, and scrolls the content down as it generates
> responses. this is a clear bug, needs a fix.

## Goals

- Reproduce on vanilla `dev`, fix it, open an upstream PR, land on
  `dev-nowaker`, and build both hosts.

## Constraints and non-goals

- Submit-time scrolling is item 2, another session.
- No TUI tab, vibeterm tmux server or `opencode-serve-*` unit restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` (GitHub fork + GitLab) | `fix-scroll-follow` | - | `ecfa7cb318` | new branch off upstream `dev` `907b3bc518`; head of PR #53219 |
| `opencode` | `dev-nowaker` | `0b0357e848` | `6ff168d896` | cherry-pick, fast-forward; pushed to `origin` and `nowaker-github` |
| `opencode` (m4max) | `dev-nowaker` | `0b0357e848` | `6ff168d896` | fast-forward from `origin` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Keep a scrolled-up reader's place in a long session](../features/2026-10-04-scroll-anchor.md) | introduced | regression test fails without the fix; isolated TUI before/after samples |
| [TUI streaming render throttle](../features/2026-08-25-tui-stream-throttle.md) | re-verified, unchanged | installed fork binary held a scrolled-up view through a streamed agent run under 100 messages, same as vanilla |

## Other delivered work

- No new upstream issue. Searching for "scroll jumps while streaming",
  "scrolled up auto scroll", "scroll position long session",
  "auto-scroll interrupts reading" and "sticky scroll" found open issue
  #41243. It records the same root cause; its PR #41247 was closed by
  `automated-pr-cleanup` on 2026-09-08 without review. PR #53219 closes
  #41243.

## Verification

- Vanilla `dev` from source, TUI in tmux socket `oc-tui-scroll`, isolated XDG
  dirs, local fake OpenAI-compatible servers in the worktree's `tmp/`:
  - under 100 messages, plain text, then a multi-step agent run with
    reasoning and bash tool calls: wheel, PageUp and line-up hold for 8-20 s
    while the stream continues; `End` shows the stream moved on;
  - a session past 100 messages, token-sized markdown: the scrolled-up view
    slides from `Step 96` to `Step 101` in 20 s;
  - instrumented run: `scrollTop` and the manual-scroll flag stay fixed while
    the first child's offset jumps by its height on every prune.
- Fix from source, same session past 100 messages: view stays at
  `Step 586 closing` / `Step 587 bullet two` for 40 s; `End` resumes
  following at `Step 596`.
- `packages/tui`: `bun test test/util/scroll.test.tsx` 2 pass (anchor test
  fails with the hook disabled); full `bun test` on `dev-nowaker` + fix:
  219 pass, 1 skip, 0 fail; `bun typecheck` passes. On upstream `dev` the full
  suite had one failure in `DiffViewerFileTree`, which passed twice alone.

## Build and install

- Build command: `.vibeterm/build.sh` in each host's primary checkout.
- Installed artifact: desktop and m4max both `1.18.34-vt-78-907b3bc518`,
  built at `6ff168d896`; desktop inode `49955453`. Both binaries contain the
  `layout-changed` anchor and the retry-header marker.
- Running services: none restarted on either host; running TUIs pick up the
  build only after their own restart.

## Commit provenance

- `6ff168d896` - fix and regression test.
- Required trailer: `AI-Session-ID: ses_ef81ca107ffet5DwnFLaGWlUap`

## Unknowns and blocked verification

- The installed binaries were not driven in a session past 100 messages; the
  source build was.
