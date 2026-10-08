# Keep a failed prompt instead of losing it, without sending it twice

## Identity

- Workday: 2026-10-07
- Session: `ses_ee74c94dfffe71uYsYScadAio7`
- Agent/platform: `Sisyphus - ultraworker` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `submit-retain-draft` off `dev-nowaker`
  `0f9bbfb297`, rebased onto `691eb77ded`; vanilla comparison worktree
  `vanilla-submit-repro` at upstream `dev` `a697115b20`
- Upstream base: `907b3bc518` (upstream `dev`) for `dev-nowaker`; unchanged
- Source result commit(s): `777a8045b8`
- Forklog commit: this file's introducing commit

## User requests

Spawned by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` as effort item 22;
the verbatim request is in the
[feature record](../features/2026-10-07-tui-prompt-admission.md#original-request).

## Goals

- Failed prompt admission keeps the draft; edits typed meanwhile survive.
- Ambiguous outcomes reconcile by a stable message ID; no duplicates.
- Persistent pending and failure feedback; docs updated.

## Constraints and non-goals

- No blanket prompt retry, no database-acquisition wrapper; the database
  root cause belongs to `ses_eebf2e45cfferJAfg1d5eBsDB6`.
- No TUI tab, serve unit or default/vibeterm tmux server restarted; QA ran on
  a throwaway tmux socket `qa-submit` with scratch XDG, DB, tools and plugins
  directories.
- No upstream PR yet, pending the user's v1/v2 branch decision.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `691eb77ded` | `777a8045b8` (+ another session's `47a421a8fe`) + this forklog commit | rebase `submit-retain-draft` onto `691eb77ded`, fast-forward; pushed to `origin` and `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Keep a failed prompt instead of losing it, without sending it twice](../features/2026-10-07-tui-prompt-admission.md) | introduced | admission and sync tests; tmux QA A-D; vanilla repro |

## Other delivered work

- Upstream `v2` check (`c28e9ec311`): partly fixed there; gaps recorded in the
  feature's maintenance notes.

## Verification

- `bun typecheck` and `bun run test` in `packages/tui` at `777a8045b8` - exit
  0; 337 pass, 1 skip, 0 fail. Pre-push whole-monorepo typecheck passed.
- Manual surface: see the feature record's Verification section.

## Build and install

- Build command: `nice -n 10 ./.vibeterm/build.sh` at `47a421a8fe` (source
  equal to `777a8045b8`) on desktop; on m4max after fast-forwarding
  `~/projects/webapps/opencode` from `691eb77ded` to `47a421a8fe`,
  `bun install --frozen-lockfile` then the same build, in the background.
  No other `build.sh` was running on either host.
- Installed artifact: desktop `1.18.34-vt-153-907b3bc518` (inode
  `49946726`), m4max `1.18.34-vt-153-907b3bc518` (inode `22183760`); both
  contain `Resend unconfirmed prompt` and `OPENCODE_RETRY_MAX_HEADER_DELAY_MS`.
- Retry-header cap: `git apply --check -R` of the canonical patch succeeded on
  both hosts before the build.
- Running services: none restarted; `opencode-serve-tailscale` PID `2994070`
  and `opencode-serve-lan` PID `2994178` (started 12:23:46/47 CDT) unchanged
  across the desktop build.

## Commit provenance

- `777a8045b8` - client IDs, admission tracking, restore/stash, resend,
  sync dedupe, docs.
- Required trailer: `AI-Session-ID: ses_ee74c94dfffe71uYsYScadAio7`

## Unknowns and blocked verification

- Running TUIs pick the change up on their next restart; not exercised in a
  real user tab.
- Residual race: a resend whose lookup misses while the original write is
  still pending stores one message but can start a second assistant turn;
  the server's `loop` joins only a run still in progress.
