# Hand a clicked commit hash to plugins

## Identity

- Workday: 2026-10-20
- Session: `ses_ea36bec92ffeijTeQtWfT4KIU4`
- Agent/platform: opencode, `anthropic/claude-opus-5-5` / linux
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `feat/click-commit-kind`
- Upstream base: `dfb56f76c7` (`v1.19.0`)
- Source result commit(s): `9f2a993d24`
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (2026-10-20):

> let's also recognize text like this f1e1275 as git commits, and let's come
> up with some good ideas for handling them. wire the handler mechanism, and
> propose all actions that make sense, even implement them - pick defaults -
> and ask to confirm. should consider gui and tui git viewers.

## Goals

- A click on a commit hash in the transcript reaches Vibeterm's route plugin,
  which asks git and opens a viewer, the forge page or a copy.

## Constraints and non-goals

- opencode decides only the token's shape; whether it is a commit is the
  plugin's question.
- No copy when no plugin takes it: a click on a hex-looking number must not
  start copying where it did nothing before.
- No right-click handling in opencode: Vibeterm's tmux `MouseDown3Pane`
  binding handles a right click on a hash before opencode sees it.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| opencode fork | `dev-nowaker` | `494eacf8e3` | this record's commit | fast-forward from `feat/click-commit-kind` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Click controls](../features/2026-10-07-tui-click-controls.md) | extended | `test/ui/id-click.test.ts` |

## Other delivered work

- opencode-tools `feat/commit-click`: commit recognition, the `clicks.commit.*`
  actions (tig, lazygit, git show, gitk, forge page, copies), the route
  plugin's `commit` handler, every Vibeterm pane and plain shell panes.

## Verification

- `bun test test/ui/id-click.test.ts` in `packages/tui` - 9 pass.
- `tsc --noEmit` in `packages/tui` - no errors in the changed files.
- `.vibeterm/build.sh` (worktree source, v2 guard gate green) installed
  `1.19.0-vt-372-dfb56f76c7` on desktop and m4max.
