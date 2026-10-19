# Delivery provenance view in the TUI

## Identity

- Workday: 2026-10-19
- Session: `ses_eaca3043cffex00KfTm0HE9UJr`
- Agent/platform: opencode (anthropic/claude-opus-5-5) / linux
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-provenance`
- Upstream base: `dfb56f76c7` (upstream `v1`, contains `v1.19.0`); fork tip `0a6d075e52`
- Source result commit(s): `ad24b3b1e2`, integrated onto `dev-nowaker` `ea0e25b4b4` (after `e160264623`) by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` once the user approved landing (2026-10-19)
- Forklog commit: this file's introducing commit

## User requests

Coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, on behalf of `ses_ebc8f2bc4ffehcETvBMsNJHPhX`:

> You own the opencode TUI side of the delivery-provenance work. [...] Leave a tested worktree diff, and report its exact paths and test evidence so the parent can review the candidate. No merge, no build.sh install, and no restarts.

## Goals

- See [Expandable delivery provenance on user messages](../features/2026-10-19-delivery-provenance-view.md).

## Constraints and non-goals

- No commit, push, merge, build.sh install or restart.
- Contract settled by `ses_ebc8f2bc4ffehcETvBMsNJHPhX`; codec built by `ses_eaca351faffe2VISjy6xXM6q2p`.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| opencode fork | `tui-provenance` | `0a6d075e52` | `0a6d075e52` + uncommitted diff | worktree diff |
| opencode fork | `dev-nowaker` | `e160264623` | `ad24b3b1e2` | coordinator applied the frozen diff and committed it |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Expandable delivery provenance](../features/2026-10-19-delivery-provenance-view.md) | introduced | tests and manual surface below |

## Verification

- See the feature's Verification section; all run in this session.

## Build and install

- Build command: not run (landing held).
- Installed artifact: not installed.
- Running services: not touched.

## Commit provenance

- `ad24b3b1e2` feat(tui): expandable delivery provenance and composer delivery metadata
- Required trailer: `AI-Session-ID: ses_eaca3043cffex00KfTm0HE9UJr`

## Unknowns and blocked verification

- None.
