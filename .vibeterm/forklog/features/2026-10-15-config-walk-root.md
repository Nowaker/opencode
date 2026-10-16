# Read project config above the git root (v2 backport)

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `config-walk-root` (worktree off `dev-nowaker`)
- First local commit: `baba8723fe`
- Current local commit(s): `baba8723fe`
- Upstream base when introduced: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Last checked against upstream: `dfb56f76c7`
- Upstream: **fork-only backport of upstream v2 behaviour, deliberately no
  upstream PR.** Upstream `v1` takes critical fixes only; v2 already behaves
  this way. Mirrors upstream `dev` at `e25b7abf89`:
  `packages/core/src/config/discovery.ts:76-108` (walk with no stop, global
  guards) and `:124,126` (farthest first), `packages/core/src/config.ts:272-287`
  (merge order).

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, the user verbatim:

> opencode.json overrides per project work. but does opencode.json override
> file in .. from project root also get taken into account or not?

and, after an answer saying v1 stops at the Git repository root:

> backport this to our v1. treat like it's our contribution mark a forklog
> entry so we never lose track of it; no PR.

## Goals

- `opencode.json`, `opencode.jsonc` and `.opencode/` are found from the working
  directory up to the filesystem root, past the git worktree, as in v2.
- Nearest wins: files and `.opencode/` directories are merged farthest first.
- Global config stays lowest; a global config file or directory reached by the
  walk is not read again as project config; no walk when the directory is a
  global config directory.

## Non-goals

- `AGENTS.md` instruction discovery: v2 walks it separately and stops at
  `$HOME` or the project root (`config/plugin/instruction.ts:39`), so it is
  not part of this walk and is unchanged.
- Skill discovery in `.claude/` and `.agents/` (`skill/index.ts`, still
  stopped at the worktree). v2 finds those in the same walk; not requested.
- `tui.json` discovery: it already walked to the filesystem root in v1. It now
  shares the global guards and nearest-wins `.opencode/` order.

## Rationale and constraints

- v1 `ConfigPaths.files`/`directories` passed `stop: worktree` to `fs.up`;
  a non-git directory has worktree `/`, so only repositories were cut short.
- v1 listed `.opencode/` directories nearest first and loads them in order, so
  the farthest one won; reaching past the repository would have let a parent's
  `.opencode/` override the project's. The reversed order matches v2.
- `~/.opencode/` is still added when the walk does not reach it (working
  directory outside `$HOME`), as in v1; inside `$HOME` it takes its walk
  position, as in v2.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `baba8723fe` | 2026-10-15 | walk to filesystem root, farthest first, global guards; docs | `ConfigPaths.files`, `ConfigPaths.directories`, `globalDirectories` in `packages/opencode/src/config/paths.ts`; callers in `config/config.ts` (no worktree argument); tests `reads project config above the git worktree...` in `test/config/config.test.ts`; "Per project" in `packages/web/src/content/docs/config.mdx` |

## Verification

Reported by `ses_ebdb29581ffeD6A9dXs1sZAis2`; see its
[session record](../sessions/2026-10-15-config-walk-root.md).

## Timeline

- 2026-10-15 [`ses_ebdb29581ffeD6A9dXs1sZAis2`](../sessions/2026-10-15-config-walk-root.md) -
  initial build, install on desktop and m4max (vt-305), installed-binary proof.
  Evidence: `baba8723fe`; `debug config` before/after.

## Current maintenance notes

- On a v1 bump, keep `paths.ts` free of `stop: worktree` and keep the
  `.toReversed()` on the project walk; check whether upstream v1 changed
  `ConfigPaths` callers (`config.ts`, `tui.ts`).
- Superseded when the fork moves to v2, which has the behaviour natively.
- Tests walk to `/`, so run them with `TMPDIR` outside any checkout that has
  its own `opencode.json` or `.opencode/` (Vibeterm tabs set `TMPDIR` to the
  repo's `.vibeterm/tmp`): `TMPDIR=/tmp/x bun test test/config/`.
- A session in a linked worktree under `.vibeterm/worktrees/` now also merges
  the main checkout's `opencode.json` and `.opencode/`; the worktree's own
  files win on conflicts. v2 behaves the same.
