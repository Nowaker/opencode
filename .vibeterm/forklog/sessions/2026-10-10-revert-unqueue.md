# Revert messages vs files, fast revert, unqueue

## Identity

- Workday: 2026-10-10
- Session: `ses_ed759a0b4ffeCubC9xxc8hYgHY`
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `revert-modes` (worktree off `dev-nowaker` `a0692476c5`); upstream `v1-revert-messages`, `v1-unqueue-prompt` off `907b3bc518`
- Upstream base: `907b3bc518` (upstream `dev`); unchanged
- Source result commit(s): `c199a85944`, `ddfb911883`, `7c6a2b63f3`
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` as item 29; the
user's words are quoted in the two feature records below.

## Goals

- Choose between reverting messages only and messages and files; no snapshot
  on the former, and Redo never touching files after it.
- A revert visible at once under CPU load, with a cheap messages-only path.
- Unqueue a prompt queued behind a running turn, refusing a lost race.

## Constraints and non-goals

- Upstream PRs keep upstream's default (`revert.files: true`); the fork
  defaults to messages only.
- Scratch database and clone for measurements, never the live database; no
  TUI tab, serve unit or `vibeterm` tmux server restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `a0692476c5` | `7c6a2b63f3` + this forklog commit | three commits on `revert-modes`, fast-forward; pushed to `origin` and `nowaker-github` |
| `opencode` | `v1-revert-messages` | - | `0737c14d50` | `c199a85944` cherry-picked onto `907b3bc518`; PR #54436 |
| `opencode` | `v1-unqueue-prompt` | - | `d86f7b11ea` | `ddfb911883` on `v1-revert-messages`; PR #54437 |
| `opencode-tools` | `master` | `9343cff` | `e40d63d` | README rows for `loaded-guns.ts` and `snapshot-restore-audit.ts`; pushed to `origin` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Revert messages without reverting files, shown at once](../features/2026-10-10-tui-revert-messages.md) | introduced | `c199a85944`, `7c6a2b63f3`; tests and timings in the record |
| [Unqueue a prompt waiting behind the running turn](../features/2026-10-10-tui-unqueue-prompt.md) | introduced | `ddfb911883`; race test and PTY run in the record |

## Other delivered work

- Upstream PRs [#54436](https://github.com/anomalyco/opencode/pull/54436) and
  [#54437](https://github.com/anomalyco/opencode/pull/54437) (stacked), v1
  note first, attribution last, no AI trailers in their commits. #54437 puts
  text typed meanwhile in the prompt stash, since upstream has no
  `prompt/merge.ts`.
- Observed, not changed: a file revert whose patch hashes are missing from
  the snapshot repository deletes those files ("file did not exist in
  snapshot, deleting"). Seen in the scratch clone only.

## Verification

- packages/opencode: `bun typecheck` clean; `revert-compact.test.ts` 11 pass;
  `prompt.test.ts` 68 pass, 1 fail (`drops an interrupted trailing
  assistant...`, fails identically without these commits);
  `httpapi-session.test.ts` new tests pass; `sdk-error-shape` and
  `httpapi-sdk` each fail one test identically without these commits.
- packages/tui: `bun typecheck` clean; `bun test` 390 pass, 0 fail.
- SDK generation run twice; the second changed nothing.
- Upstream branches: typecheck clean; `v1-revert-messages` packages/opencode
  33 pass in the revert and route files; `v1-unqueue-prompt` unqueue tests
  5 pass, packages/tui 202 pass.
- Measurements and PTY runs: see the feature records.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh`
  on desktop and on m4max (after fast-forwarding its checkout to `7c6a2b63f3`).
- v1 database guard gate: PASSED on both hosts.
- Installed artifact: desktop `1.18.34-vt-198-907b3bc518` (inode `49952707`),
  m4max `1.18.34-vt-198-907b3bc518` (inode `27536658`); both contain
  `session.unqueue`, `Revert messages and files` and the retry-header marker.
- Retry-header cap: the dirty diff matched the canonical patch on both hosts.
- Running services: none restarted; desktop `opencode-serve-tailscale` kept
  PID `697069`, started 2026-10-10 17:54:13 CDT.

## Commit provenance

- `c199a85944` - revert messages without files, shown at once
- `ddfb911883` - unqueue a queued prompt
- `7c6a2b63f3` - fork default `revert.files: false`
- Required trailer: `AI-Session-ID: ses_ed759a0b4ffeCubC9xxc8hYgHY`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-10-revert-unqueue.md
```

## Unknowns and blocked verification

- The unqueue `started` refusal was exercised by tests only; in the TUI the
  QUEUED mark goes away when the turn picks a prompt up, so the refusal shows
  only in a race.
