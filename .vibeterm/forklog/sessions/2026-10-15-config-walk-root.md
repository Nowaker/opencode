# Backport v2's project config walk above the git root

## Identity

- Workday: 2026-10-15
- Session: `ses_ebdb29581ffeD6A9dXs1sZAis2`
- Agent/platform: opencode, `anthropic/claude-opus-5-5` / linux
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `config-walk-root`
- Upstream base: `dfb56f76c7` (`v1.19.0`); v2 reference `github/dev` `e25b7abf89`
- Source result commit(s): `baba8723fe`
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 39):

> opencode.json overrides per project work. but does opencode.json override
> file in .. from project root also get taken into account or not?

> backport this to our v1. treat like it's our contribution mark a forklog
> entry so we never lose track of it; no PR.

## Goals

- Verify v1 and v2 discovery from source, then port v2's walk to v1 exactly.

## Constraints and non-goals

- No upstream PR. No serve unit restarts. `tui.json` untouched.

## Findings (source)

- v2 `github/dev`: `packages/core/src/config/discovery.ts:80` calls
  `fs.up({ targets: ["."], start })` with no `stop`, so the walk reaches `/`
  (`packages/util/src/fs-util.ts:165-187`). It checks `.claude`, `.agents`,
  `.opencode`, `opencode.jsonc` and `opencode.json` in each directory (`:85`).
  There is no walk when the cwd is the system or global config directory, or
  with `project: false` (`:77-80`). Global roots and files are filtered out
  (`:101-108`). Results are ordered farthest first (`:124,126`). Merge order
  (`config.ts:272-287`): global, explicit, direct files, then project
  `.opencode/`.
- v1 `dev-nowaker` before: `packages/opencode/src/config/paths.ts:16-20`
  (files) and `:28-32` (`.opencode/`) passed `stop: worktree`. `.opencode/`
  directories were nearest first, so the farthest won, and `~/.opencode/`
  beat the project's.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| opencode fork | `dev-nowaker` | `59deec6f56` | `baba8723fe` | fast-forward from `config-walk-root` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Read project config above the git root](../features/2026-10-15-config-walk-root.md) | new | `test/config/config.test.ts`, `debug config` proof |

## Verification

- `TMPDIR=/tmp/oc-cfgwalk bun test test/config/` - 233 pass, 3 fail. The same
  3 fail on `59deec6f56`: `creates global jsonc config...`, `V2 configuration
  loading > logs compatibility diagnostics...`, `keeps server and tui plugin
  merge semantics aligned`. 4 new tests pass: parent-of-repo file read with the
  nearer file winning, global lowest, `.opencode/` nearer wins, global file not
  re-read through the walk.
- `bun test test/skill test/plugin test/tool/registry.test.ts` - 251 pass.
- `bun typecheck` (packages/opencode) - exit 0.
- Installed-binary proof, scratch `XDG_*`/`HOME`/`OPENCODE_TOOLS_DATA_DIR`/
  `OPENCODE_PLUGINS_DATA_DIR`. The tree is `x/opencode.json` (model
  `parent/model-from-x`, username `parent-x`), `x/repo` (git repo) with
  `opencode.json` (model `repo/model-from-repo`), and global
  `{model: global/model, username: global, snapshot: false}`. Running
  `opencode debug config` in `x/repo`:
  - vt-305: `{"model":"repo/model-from-repo","username":"parent-x","snapshot":false}`
    on desktop and m4max.
  - vt-304 (`opencode.prev-1792114656`): `{"model":"repo/model-from-repo","username":"global","snapshot":false}`.

## Build and install

- Build command: `VIBETERM_V2_GUARD=.../vibeterm-v2-guard .vibeterm/build.sh`,
  primary checkout, desktop and m4max (checkout fast-forwarded to
  `baba8723fe`).
- Installed artifact: `1.19.0-vt-305-dfb56f76c7` on both; v2 migration guard
  gate PASSED on both.
- Running services: not restarted.

## Commit provenance

- `baba8723fe` - walk, tests, docs
- Required trailer: `AI-Session-ID: ses_ebdb29581ffeD6A9dXs1sZAis2`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-15-config-walk-root.md
```

## Unknowns and blocked verification

- None.
