# Tracked build script and vt version stamp

## Identity

- Workday: 2026-09-29
- Session: `ses_f0fa472b3ffewPFKUIOfLnesvB`
- Agent/platform: `Sisyphus - ultraworker` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `vt-version-stamp` (worktree
  `~/projekty/webapps/opencode-vt-version-stamp`)
- Upstream base: `2406400f0a` (upstream `dev`, contains `v1.18.32`); unchanged
- Source result commit(s): `8bfa57bb26`
- Forklog commit: this file's introducing commit

## User requests

Spawned as track C of a five-track feature by coordinator
`ses_f0fb0c406ffewPrI2P1ighbjaX`. From the brief:

> Move it into the fork, committed on `dev-nowaker` [...] Replace the old path
> with a thin shim that execs the repo script [...] It becomes
> `<base>-vt-<seq>-<sha>` [...] Audit every consumer of the stamped version
> inside the fork [...] Fix each one so the base version is used where a
> registry or semver range needs it. [...] Do NOT rebase `dev-nowaker` onto
> newer upstream here.

## Goals

- Build script tracked at `.vibeterm/build.sh`; the old path is a shim.
- `opencode --version` prints `<base>-vt-<seq>-<sha>`.
- Registry pins, plugin `engines` ranges and the upgrade check keep working.

## Constraints and non-goals

- No restart of any `opencode-serve-*`, `opencode-sandbox-local` or
  `opencode-tailscale-dev` unit.
- No reintegration onto `v1.18.33`; that is the updater track's test.
- Format agreed with opencode-tools track A (`ses_f0fa4eeb2ffeCK4CgSuJrjCfLu`),
  whose parser is `_lib/opencode-binary/vt-version.ts`.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `d1d03f9ef4` | this forklog commit | fast-forward from `vt-version-stamp`; pushed to `origin` and `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Tracked build script and vt version stamp](../features/2026-09-29-vt-version-stamp.md) | new | unit test, typechecks, installed `--version` |

## Other delivered work

- `~/projekty/webapps/opencode-build/build.sh` replaced by a shim that
  `exec`s `~/projekty/webapps/opencode/.vibeterm/build.sh`; the original is
  archived beside it as `build.sh.pre-tracked`.
- opencode-tools: `_lib/vibeterm-instance/docker.ts opencodeVersion()` stamps
  the same vt form for source-built instance images; AGENTS.md and READMEs
  point at the tracked script.

## Verification

- `bun test test/installation-version.test.ts` (packages/core) - 3 pass.
- `bun run typecheck` in packages/core, packages/opencode, packages/tui - exit 0.
- `bun test test/plugin test/config` (packages/opencode) - 435 pass / 5 fail;
  identical 5 failures on `d1d03f9ef4` without this change (pre-existing).
- `.vibeterm/build.sh --print-version` - `1.18.32-vt-50-2406400f0a` (48 fork
  commits before this session plus its 2); `OPENCODE_VERSION=1.2.3` prints
  `1.2.3`; an unknown or extra argument exits 2 naming it; `--help` exits 0.
- Build log: Script module reported `channel: latest`, `preview: false`.
- Installed `bin/opencode --version` - `1.18.32-vt-50-2406400f0a`.
- Fresh isolated process (`HOME` under the worktree's `tmp/`, `env -i`):
  `opencode agent list` exit 0 with a local path plugin whose
  `engines.opencode` is `>=1.0.0`; the plugin wrote its load marker. The
  config directory's `package.json` got `@opencode-ai/plugin: 1.18.32`, the
  base rather than the stamp. For contrast, `semver.satisfies` returns false
  for the stamp against `>=1.0.0` and true for the base.

## Build and install

- Build command: `OPENCODE_SRC` unset, `.vibeterm/build.sh` run from the
  `vt-version-stamp` worktree (the primary checkout carried another
  session's uncommitted edits).
- Installed artifact: `1.18.32-vt-50-2406400f0a`, inode 49968661 (previous
  49968294 archived as `opencode.prev-1790741465`).
- Running services: `opencode-sandbox-local` 14369, `opencode-serve-lan`
  14381, `opencode-serve-tailscale` 14398, `opencode-tailscale-dev` 14431, all
  started 2026-09-29 19:30:50 CDT, same PIDs and start times before and after
  the build. Nothing was restarted.

## Commit provenance

- `8bfa57bb26` - feat(build): stamp fork builds as <base>-vt-<seq>-<sha>
- Required trailer: `AI-Session-ID: ses_f0fa472b3ffewPFKUIOfLnesvB`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-09-29-vt-version-stamp.md
```

## Unknowns and blocked verification

- None.
