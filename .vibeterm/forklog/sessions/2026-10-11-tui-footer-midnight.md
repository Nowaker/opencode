# On-screen times switch to the date at midnight

## Identity

- Workday: 2026-10-11
- Session: `ses_ee68aab01ffei41gwUGJ5ESj6W`
- Agent/platform: `Sisyphus - ultraworker` (anthropic/claude-opus-5-5, high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode` (GitLab `origin`, GitHub `nowaker-github`)
- Integration branch: `dev-nowaker`
- Development branch(es): `footer-elements` (worktree); upstream `tui-footer-elements`, `tui-tool-collapse`
- Upstream base: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Source result commit(s): `c6420431f8`
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, the user looking at
`Click to expand · 22:01:28 · 464ms`:

> do these dates dynamically change to YYYY-MM-DD +time after midnight? if
> so, it should be part of the feature.

## Goals

- Every today/date decision reads one shared local-day signal, so footers,
  entry timestamps, the compaction divider and the dialogs switch at 00:00
  without a scroll or restart.
- One timer, not one per footer; a suspend or clock/timezone change caught
  within the hour; no idle-CPU regression.

## Constraints and non-goals

- Never touch the primary checkout's uncommitted retry patch or `.gitignore`.
- No serve or tab restarts.
- The prompt line keeps upstream's time-then-date order
  (`todayTimeOrDateTime`).

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `4a66b92d2c` | `c6420431f8` | pushed from the `footer-elements` worktree to both remotes (local `dev-nowaker` held session `ses_ed7634c31ffeH84yR0S99Ty8Nd`'s unpushed commit, which it then rebased on top) |
| `opencode` (GitHub fork + GitLab) | `tui-footer-elements` | `386ad3875a` | `3bd1b72349` | change folded into the feature commit, no AI trailers; force-with-lease both remotes; PR #53877 body updated |
| `opencode` (GitHub fork + GitLab) | `tui-tool-collapse` | `927b0d673b` | `0dde205f4a` | restacked on `3bd1b72349`; force-with-lease both remotes |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Choose every message footer detail the same way](../features/2026-10-07-tui-footer-elements.md) | extended: midnight flip | `day.test.tsx`, preload-shifted TUI capture |
| [Per-turn completion time and duration](../features/2026-10-04-tui-turn-timing.md) | extended: its today check (`8cca718c9e`) is now reactive | same |

## Other delivered work

- PR #53877 cannot be retargeted to `v1`: GitHub refuses to change the base of
  a closed PR. Its branch sits on `v1` `dfb56f76c7`.

## Verification

- `bun typecheck` in `packages/tui` exit 0; full suite 455 pass, 1 skip,
  0 fail; upstream stacks 107 and 101 focused tests pass; pre-push hook
  30/30 on every push.
- Manual surface: see the feature record's `c6420431f8` verification entry.
  `bun run --preload` was silently ignored; `bun --preload <file> src/index.ts`
  from `packages/opencode` applied it.

## Build and install

- desktop: `.vibeterm/build.sh` at `5ffc6cea9f` (retry patch sha1 matches the
  canonical patch, `VIBETERM_V2_GUARD` set, guard gate passed):
  `1.19.0-vt-231-dfb56f76c7`, inode `49968795`, with the retry-cap and
  midnight schema markers. `opencode-serve-tailscale` (PID 1994449) and
  `opencode-serve-lan` (PID 3308427) kept their PIDs and start times.
- m4max: checkout fast-forwarded to `5ffc6cea9f`; `1.19.0-vt-231-dfb56f76c7`,
  inode `30334723`, guard gate passed, same markers and matching retry patch.
- Running TUIs pick it up on their next restart.

## Commit provenance

- `c6420431f8` - shared local-day signal; today checks flip at midnight.
- Required trailer: `AI-Session-ID: ses_ee68aab01ffei41gwUGJ5ESj6W`

## Unknowns and blocked verification

- Not observed at a real local midnight; verified by fake timers and a
  `Date`-shifting preload in an isolated TUI.
