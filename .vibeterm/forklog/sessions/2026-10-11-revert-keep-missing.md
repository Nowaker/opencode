# Revert must never delete a file whose earlier content was pruned

## Identity

- Workday: 2026-10-11
- Session: `ses_ed759a0b4ffeCubC9xxc8hYgHY`
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `revert-keep-missing` (off `github/v1` `dfb56f76c7`); `keep-missing-land` (off `dev-nowaker` `927f4315a3`)
- Upstream base: `dfb56f76c7` (upstream `v1`, `v1.19.0`); unchanged
- Source result commit(s): `69ec5e063c` (fork), `98d128cad0` (upstream branch)
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`; the user's words are
quoted in the feature record.

## Goals

- Find existing reports, reproduce, fix on `v1`, open issue and PR, land and
  install in the fork.

## Constraints and non-goals

- Scratch stores and a throwaway tmux socket only; no tab, serve unit or
  `vibeterm` tmux server restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `revert-keep-missing` | - | `98d128cad0` | fix on `github/v1`; PR #54578 |
| `opencode` | `dev-nowaker` | `927f4315a3` | `69ec5e063c` + this forklog commit | cherry-pick on `keep-missing-land`, fast-forward; pushed to `origin` and `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Never delete a file whose earlier content the snapshot store lost](../features/2026-10-11-revert-keep-missing.md) | introduced | `69ec5e063c`; tests and PTY run in the record |
| [Revert messages without reverting files, shown at once](../features/2026-10-10-tui-revert-messages.md) | preserved | `revert-compact.test.ts` messages-only tests pass beside the new one |

## Other delivered work

- Issue [#54577](https://github.com/anomalyco/opencode/issues/54577), marked
  critical data loss for v1, and PR
  [#54578](https://github.com/anomalyco/opencode/pull/54578) against `v1`;
  attribution line last, no AI trailers in the upstream commit.

## Verification

- packages/opencode: `bun typecheck` clean; fork `snapshot.test.ts` +
  `revert-compact.test.ts` 69 pass; upstream branch 95 pass across four files.
- The two new tests fail without the source fix.
- packages/tui: `bun typecheck` clean; `revert.test.ts` 8 pass.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh`
  on desktop and on m4max (after fast-forwarding its checkout to `69ec5e063c`).
- v1 database guard gate: PASSED on both hosts.
- Installed artifact: desktop `1.19.0-vt-218-dfb56f76c7` (inode `49952717`),
  m4max `1.19.0-vt-218-dfb56f76c7` (inode `30156474`); both contain the new
  log message and the retry-header marker.
- Retry-header cap: the dirty diff reverse-applied the canonical patch on both hosts.
- Running services: none restarted; desktop `opencode-serve-tailscale` kept
  PID `1994449`, started 2026-10-11 05:45:32 CDT.

## Commit provenance

- `69ec5e063c` - never delete a file whose earlier content is not stored
- Required trailer: `AI-Session-ID: ses_ed759a0b4ffeCubC9xxc8hYgHY`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-11-revert-keep-missing.md
```

## Unknowns and blocked verification

- None.
