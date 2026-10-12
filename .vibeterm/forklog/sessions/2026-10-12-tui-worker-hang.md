# `opencode -s` hang on a locked database: maintenance retry and worker error replies

## Identity

- Workday: 2026-10-12
- Session: `ses_eebf9a83fffeIQQwW9gVFo5jaO`
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (variant max) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `rpc-error-reply` (off upstream `v1` `dfb56f76c7`, upstream PR head `2cef65ac7a`); `session-maintenance-retry` (off `dev-nowaker`, also the landing branch); `rpc-hang-fork-probe` (throwaway diagnosis worktree)
- Upstream base: `dfb56f76c7` (upstream `v1`, `v1.19.0`); unchanged
- Source result commit(s): `22e6326a61` (maintenance retry), `c50b7366df` (cherry-pick of `2cef65ac7a`)
- Forklog commit: this file's introducing commit

## User requests

19b `ses_eeadda349ffep0Jwwis5g1DJXi` reported the hang:

> From ses_eeadda349ffep0Jwwis5g1DJXi (19b/19c): an opencode
> instant-session-screen HANG in the fork, live and inspectable right now on
> desktop.

The coordinator `ses_ef8235798ffejGr4sa22eXmVNv` asked for the fix and report;
the regression rule is quoted in the
[feature record](../features/2026-10-12-tui-worker-error-reply.md#original-request):

> Report to me when done, with: the cause in plain words, the introducing
> commit, the dev-nowaker commits on both remotes, the installed vt version on
> desktop AND m4max (build.sh with the v2 guard gate), any PR, a real
> reproduction before/after (locked DB while several opencodes start), and
> try-steps for the user. Also correct what you told 19b
> (ses_eeadda349ffep0Jwwis5g1DJXi) with a vibeterm_notify_session queue note.

## Goals

- Find why a restarted `opencode -s` tab (pid 4182609, `1.19.0-vt-241`) sat on
  "Loading session…" for 9.8 h, and make a busy database at startup delay
  opencode or end it with an error, never hang it.

## Constraints and non-goals

- The hung process was inspected read-only, then released to 19b.
- Isolation: scratch `XDG_*`, `OPENCODE_TOOLS_DATA_DIR`,
  `OPENCODE_PLUGINS_DATA_DIR` and `OPENCODE_DB`, throwaway tmux socket
  `iso19hang`, provider pointed at a closed port.
- No TUI tab, service or vibeterm tmux server restarted.

## Cause

- `opencode -s` checks the session through the in-process server worker
  before it shows anything (`validateSession`, then `Rpc` `fetch`).
- Session maintenance registers itself while the database layer is built, in
  one `BEGIN IMMEDIATE` (introduced in `1eccd8068e`). When another process
  held the write lock past the 5 s busy timeout, the registration failed, the
  database layer died with it, and `app.fetch` threw instead of returning an
  error response.
- Upstream's `Rpc.listen` answers only a request that returns, and the worker
  swallows the rejection, so the TUI waited forever. Under the same 20 s lock,
  upstream `v1` answers in about 7 s with a 500, and opencode exits with an
  error.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `rpc-error-reply` | - | `2cef65ac7a` | new branch on upstream `v1` `dfb56f76c7`; pushed to `nowaker-github` and `origin`; issue #54934, PR #54936 against `v1` |
| `opencode` | `dev-nowaker` | `185940b77b` | `c50b7366df` + this forklog commit | `22e6326a61` and the cherry-pick `c50b7366df` on `session-maintenance-retry`, rebased onto the `.scm` typecheck fix; fast-forward; pushed to both remotes |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Answer a failed TUI worker request instead of hanging](../features/2026-10-12-tui-worker-error-reply.md) | introduced | `c50b7366df`; same-test red/green; port and lock repros |
| [Session replacement maintenance](../features/session-maintenance.md) | fixed | `22e6326a61`; lock-holder test red/green; maintenance suites |

## Other delivered work

- The opencode package had not typechecked on `dev-nowaker` since
  `60edf2a182`: 5 TS2307 errors on its `.scm` imports. The pre-push hook
  replayed a cached turbo pass for `opencode#typecheck`, whose hash ignores
  tui files, so the first push touching `packages/opencode` was going to be
  refused. Its owner `ses_ed1e2b932ffe6tTqhsOiGuYXRE` landed the fix tested
  here (`8e3a183698`, `*.scm` declared in `packages/opencode/src/audio.d.ts`)
  and amended PR #54706.
- 19b got the cause by a queued note; an earlier note from this session had
  wrongly called the hang an upstream `v1` bug.

## Verification

- `bun test test/session-maintenance-startup.test.ts -t "another process holding the write lock"`
  in `packages/core` on `bfc03b0daf`: without the change exit 1
  (`database is locked`); with it 1 pass.
- `packages/core` maintenance, transaction, acquisition and event-contention
  suites: 60 pass, 0 fail. After the rebase: startup and acquisition suites
  14 pass.
- `bun typecheck` in `packages/core` and `packages/opencode` on the landing
  branch: clean.
- RPC change: see the feature record.
- Source repro on the landing branch (`tmp/repro-hang.sh`): with a 30 s write
  lock while `opencode -s` starts, it loads within 10 s of the release; the
  unfixed fork stays blank.
- Installed binaries, three `opencode -s` started at once while another
  process holds the write lock (`tmp/repro-many.sh`), checked 10, 30 and 60 s
  after the release:

  | Binary | Lock | Result |
  |---|---|---|
  | desktop `1.19.0-vt-243` | 30 s | all three still on "Loading session…" 60 s after the release |
  | desktop `1.19.0-vt-248` | 30 s | all three loaded within 10 s |
  | desktop `1.19.0-vt-248` | 90 s | all three exit 1 with `Error: Failed to execute statement` |
  | m4max `1.19.0-vt-248` | 30 s | all three loaded within 10 s |

## Build and install

- Build command: `.vibeterm/build.sh` on both hosts, with `VIBETERM_V2_GUARD`
  set to opencode-tools' `vibeterm-v2-guard`; the v2 migration guard gate
  passed on both.
- Installed artifact: desktop `1.19.0-vt-248-dfb56f76c7` (inode `49962236`),
  m4max `1.19.0-vt-248-dfb56f76c7` (inode `31147540`); the retry marker and
  the instant-screen strings are present on both.
- Retry-header cap: the dirty diff matched the canonical patch on both hosts
  before the build.
- Running services: none restarted; `opencode-serve-tailscale` PID `4038768`
  and `opencode-serve-lan` PID `4040905` unchanged across the build.

## Commit provenance

- `22e6326a61` - session maintenance waits for a busy database before failing
  startup.
- `c50b7366df` - a failed TUI worker request gets an answer; cherry-pick of
  upstream PR commit `2cef65ac7a`, which carries no AI trailers.
- Required trailer: `AI-Session-ID: ses_eebf9a83fffeIQQwW9gVFo5jaO`

## Unknowns and blocked verification

- What held the desktop database's write lock during the 03:54 restart of
  three tabs is not established; session `ses_ed0dd417cffec7Cd7k2Zu2yCWi`
  was mid-turn then, and the other two restarted processes were starting.
- Upstream CI for PR #54936 has not run; fork PRs await maintainer approval.
- A database locked longer than 60 s at startup still ends startup, with the
  generic message `Failed to execute statement`.
