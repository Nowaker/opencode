# 2026-10-11 - end every tool call that runs past a time limit

## Identity

- Workday: 2026-10-11
- Session: `ses_ed5bde150ffepnn3xqxHaucDLN`
- Agent/platform: Sisyphus (opencode, `anthropic/claude-opus-5-5`) / darwin (m4max)
- Repository: `~/projects/webapps/opencode` (m4max), `~/projekty/webapps/opencode` (desktop)
- Integration branch: `dev-nowaker`
- Development branch(es): `tool-timeout` (worktree `.vibeterm/worktrees/tool-timeout`),
  `tool-call-limit` (upstream PR, cut from `upstream/v1`)
- Upstream base: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Source result commit(s): `d107564059` on `dev-nowaker`; `916886e976` on `tool-call-limit`
- Forklog commit: this file's introducing commit

## User requests

Spawned by coordinator `ses_edbc58128ffewRtHLGqE73V2Tj`:

> Build a hard time limit on every tool call into our opencode fork
> (/Volumes/projects/webapps/opencode, integration branch `dev-nowaker`).
> Document it, open an upstream PR, and install the build on m4max and
> desktop. The user approved this design.

## Goals

- Every tool call ends with an error at its limit, and the turn continues.
- Config keys, a plugin API and an MCP default, documented, plus an upstream PR.

## Constraints and non-goals

- Build only through `.vibeterm/build.sh`; the v2 guard gate must pass.
- Desktop builds from its own checkout.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| OpenCode | `dev-nowaker` | `813ca84dab` | `d107564059` | feature commit made on `eb93db623d`, rebased onto the v1.19.0 move (`git rebase --onto`), ff-merged |
| OpenCode | `tool-call-limit` | - | `916886e976` | cherry-pick of `d107564059` onto `upstream/v1` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [End every tool call that runs past a time limit](../features/2026-10-11-tool-call-time-limit.md) | new | focused tests, isolated binary run |

## Other delivered work

- Upstream PR [anomalyco/opencode#54503](https://github.com/anomalyco/opencode/pull/54503), base `v1`, closes #53433.
- Answered `ses_ed5bac0a0ffehjfgkLjw73OJVb` (opencode-tools plugin ceiling
  wrapper) with the plugin field: top-level `timeout`, ms, `false` = none.

## Verification

- Focused tests: 87 + 3 pass on `dev-nowaker` and on `tool-call-limit`.
- `bun typecheck`: core, opencode, plugin and sdk/js clean on both bases.
- SDK generation: re-running it was a no-op after the change.
- Broad run (`test/session test/tool test/mcp test/config test/plugin test/command`):
  1390 pass, 20 fail. The same 20 failures occur on untouched `eb93db623d`;
  they are environmental, from the worktree being nested in the primary
  checkout.
- Isolated real binary: see the feature record.

## Build and install

- m4max: `.vibeterm/build.sh` at `d107564059`. The gate passed. Installed `1.19.0-vt-212-dfb56f76c7`.
- desktop: built at `6f50c2922f` by `ses_edbc58128ffewRtHLGqE73V2Tj`. The gate passed. Installed `1.19.0-vt-213-dfb56f76c7`.
- desktop services restarted per the opencode-tools Restart policy. All came back healthy on new PIDs:
  - `opencode-serve-tailscale` 1159233 -> 1994449, vt-213
  - `opencode-serve-lan` 697093 -> 1998763, vt-213
  - `opencode-tailscale-dev` 1159286 -> 1999501, source
- `opencode-sandbox-local` runs the system `/bin/opencode` and was left alone.

## Commit provenance

- `d107564059` - feature on `dev-nowaker`
- `916886e976` - the same change on `upstream/v1` for the PR
- Required trailer: `AI-Session-ID: ses_ed5bde150ffepnn3xqxHaucDLN`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-11-tool-call-time-limit.md
```

## Unknowns and blocked verification

- m4max's `/Volumes/projects` was 100% full (1.3G free) mid-session. A cold
  `bun install` in the PR worktree left `@opentelemetry/api` half-extracted,
  and the SDK `dist` compile failed with ENOSPC after generation, which still
  matched the commit. A clean reinstall fixed the worktree.
