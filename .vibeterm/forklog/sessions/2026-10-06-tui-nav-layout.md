# Prompt-level ctrl+up/down and a returning ctrl+home

## Identity

- Workday: 2026-10-06
- Session: `ses_ef46f1775ffe29MtElYF4DQySL`
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (variant max) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-block-nav` (amended `86036a3af0` -> `fdba5ac828`), `tui-home-return` (`78ce706b7d`, stacked on it); landing branch `tui-nav-land2`
- Upstream base: `907b3bc518` (upstream `dev`); unchanged
- Source result commit(s): `50b9d3b329` (the `86036a3af0..fdba5ac828` delta), `bed5ec8209` (cherry-pick of `78ce706b7d`)
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, quoting the user:

> ctrl+up/down prompt, ctrl+shift+up/down important blocks,
> ctrl+alt+shift+up/down any block. which means new feature, modify existing
> pr if not accepted yet. also new feature for ctrl+home/end bindings. when
> you scroll up, wherever you are at, it gets remembered by opencode, then you
> ctrl+end to be back down; then you click ctrl+home and it's bringing you
> back where you were at before scrolling to the end. only subsequent
> ctrl+home press gets you to the very top.

## Goals

- New default layout: prompts on `ctrl+up/down`, landmarks on
  `ctrl+shift+up/down`, blocks on `ctrl+alt+shift+up/down`.
- `ctrl+end` remembers a scrolled-up position; `ctrl+home` returns to it, a
  second `ctrl+home` goes to the top.

## Constraints and non-goals

- PR #53333 was open with no reviews, so its commit was amended and
  force-pushed with lease; `dev-nowaker` got fix commits on top.
- Host `tui.json` left unchanged; no block-nav override added.
- No TUI tab, service or vibeterm tmux server restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `115310f98c` | `bed5ec8209` + this forklog commit | two commits on `tui-nav-land2` (one import conflict with `keepScrollAnchor`, kept both), fast-forward; pushed to `origin` and `nowaker-github` |
| `opencode` | `tui-block-nav` | `86036a3af0` | `fdba5ac828` | amend; force-push with lease to `origin` and `nowaker-github` |
| `opencode` | `tui-home-return` | - | `78ce706b7d` | new branch on `tui-block-nav`; pushed to `origin` and `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Navigate the transcript by prompt, landmark and block](../features/2026-10-05-tui-block-nav.md) | changed | `50b9d3b329`; tests; tmux captures |
| [Return to the scrolled-up position on messages_first](../features/2026-10-06-tui-home-return.md) | introduced | `bed5ec8209`; state-machine tests; tmux captures |

## Other delivered work

- Key delivery: Vibeterm's tmux binds `C-M-Up`/`C-M-Down` only in
  `copy-mode` and nothing on `C-M-S-Up`/`C-M-S-Down`; opentui parses
  `\e[1;8A` as ctrl+shift with `meta`/`option` set. Nothing swallowed.
- Upstream: issue #53331 and PR #53333 bodies and titles rewritten for the
  new layout; new issue #53629 and stacked PR #53630.

## Verification

- `bun typecheck` in `packages/tui` - exit 0 on every branch; `bun test` -
  255 pass on `tui-nav-land2`.
- Manual surface: see both feature records' Verification sections.

## Build and install

- Build command: `~/projekty/webapps/opencode-build/build.sh` on desktop;
  `.vibeterm/build.sh` on m4max after fast-forwarding its checkout to
  `bed5ec8209`.
- Installed artifact: desktop `1.18.34-vt-118-907b3bc518` (inode
  `49959373`), m4max `1.18.34-vt-118-907b3bc518` (inode `21714474`); both
  contain `ctrl+alt+shift+up`, the new `messages_first` description and the
  retry-header marker.
- Retry-header cap: the dirty diff matched the canonical patch before the
  build.
- Running services: none restarted; `opencode-serve-tailscale` PID `689071`
  and `opencode-serve-lan` PID `1509289` unchanged across the build.

## Commit provenance

- `50b9d3b329` - key layout and prompt picker.
- `bed5ec8209` - remembered position.
- Required trailer: `AI-Session-ID: ses_ef46f1775ffe29MtElYF4DQySL`

## Unknowns and blocked verification

- No real-terminal screenshots yet; both PRs have a slot for them.
