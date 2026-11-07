# tool.deferral hook

## Identity

- Workday: 2026-11-07
- Session: `ses_e940a3306ffeuueD3PBtPLwowX`
- Agent/platform: opencode / linux (Vibeterm)
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `feat/tool-exposure-hook`
- Upstream base: `006d837c50` (`v1.19.5`)
- Source result commit(s): `ac36448956`, merge `f8f7cf2e33`
- Forklog commit: this file's introducing commit

## User requests

> i would generally wan a hybrid. i'd like to define which oc tools are always exposed, and which ones are behind a list.

## Goals

- opencode-tools `toolDeferral.always` names the tools sent in full; the rest wait behind the provider's tool search.

## Constraints and non-goals

- The primary fork checkout held another session's uncommitted `retry.ts` work; the build ran from the worktree (`OPENCODE_SRC`) so it was not shipped.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `b1d5fc66c1` | `f8f7cf2e33` + forklog | merge `feat/tool-exposure-hook` |

## Features touched

- [Let a plugin keep tool schemas behind the provider's tool search](../features/2026-11-07-tool-deferral-hook.md)
