# Abort requester: route input and TUI callers

## Identity

- Workday: 2026-10-16
- Session: `ses_eb83d5fd6ffe2F4YAv9F3pW2IU`
- Agent/platform: `Sisyphus - ultraworker` (`anthropic/claude-opus-5-5`, high) / `linux`
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `abort-requester` (worktree `.vibeterm/worktrees/abort-requester`)
- Upstream base: `dfb56f76c7` (`v1.19.0`)
- Source result commit(s): `ad8da6065b`, `c459e6157b`
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`:

> Build the TUI requester part of the abort-cause feature, stacked on the server part that has already landed.

## Goals

- `POST /session/{id}/abort` accepts an optional `requester`, defaulting to `api` and rejecting unknown values.
- The TUI names itself `tui` for its interrupt and `tui-revert` for undo.

## Constraints and non-goals

- Never write `killed`; leave disposal rows without a requester.
- Leave the primary checkout's uncommitted retry-header cap and `.gitignore` edits untouched.
- No tab or service restart.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `2bf5f16042` | `c459e6157b` | fast-forward from `abort-requester`; pushed to `origin` and `nowaker-github` |
| `opencode` (m4max) | `dev-nowaker` | `2755c68f92` | `c459e6157b` | fast-forward from `origin` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Record who requested a cancel on the aborted row](../features/2026-10-16-abort-requester.md) | introduced | `test/server/session-abort.test.ts`, TUI QA below |

## Verification

- `env -u TMPDIR bun test --timeout 120000 test/server/session-abort.test.ts` (`packages/opencode`) - 1 pass, 18 expects; with the route change reverted, 0 pass 1 fail (`requester: "api"` missing).
- `env -u TMPDIR bun test test/session/prompt.test.ts test/session/run-state.test.ts test/session/message-v2.test.ts test/server` - 448 pass, 3 skip, 4 fail. Three fail identically on base `2755c68f92` (`Server.listen` port fallback, v2 location EventV2 stream, public OpenAPI `SessionBusyError`); `global-lifecycle` "does not announce global disposal when a seal rejects disposal" failed once in the broad run and passed twice alone.
- `bun test` (`packages/tui`) - 796 pass, 1 skip, 1 fail: `instant editor matches opentui's textarea` hits its 5 s default timeout under load and passes with `--timeout 60000`; it imports neither changed file.
- `bun typecheck` in `packages/opencode`, `packages/tui`, `packages/sdk/js` - exit 0; the pre-push hook typechecked the monorepo.
- Manual surface: real TUI (`opencode attach`) on a throwaway tmux socket against an isolated loopback `serve` with a synthetic streaming provider. Esc esc mid-turn stored `{cause: "cancel", requester: "tui"}`; `ctrl+x u` mid-turn stored `requester: "tui-revert"`; a bare HTTP abort stored `requester: "api"` and returned it under `$.info.error`; `?requester=killed` returned `400`. Same result on source, installed desktop and installed m4max binaries.

## Build and install

- Build command: `VIBETERM_V2_GUARD=~/projekty/nowaker/opencode-tools/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh` on both hosts.
- Installed artifact: `1.19.0-vt-343-dfb56f76c7`. Desktop inode `49958257`, sha256 `e6339fcbfd263d93a77a414b046f744a8c27f76cd34191c898f67194e0cfced3`; guard against npm v1 `1.19.3` and v2 `2.0.32`. m4max inode `42054759`, sha256 `82b934790efb7b51b0b0057233b868f4722064a93607040951d5fbe3a2d3dbee`; guard against cached v1 `1.19.0` and v2 `2.0.29` (disk reserve refused downloads).
- Running services: not restarted.

## Commit provenance

- `ad8da6065b` - route input, `api` default, SDK and docs.
- `c459e6157b` - TUI requesters.
- Required trailer: `AI-Session-ID: ses_eb83d5fd6ffe2F4YAv9F3pW2IU`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-16-abort-requester.md
```

## Unknowns and blocked verification

- On m4max the isolated `serve` started by the QA rig ignored SIGTERM after the run and was killed with SIGKILL; desktop's exited on SIGTERM. Not investigated.
- Upstream: fork-only by default; decision asked of `ses_eeda1d251ffel81U5Y42j4kb33`.
