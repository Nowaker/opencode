# Plugin tool import extension

## Identity

- Workday: 2026-11-21
- Session: [`ses_eeda1d251ffel81U5Y42j4kb33`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_eeda1d251ffel81U5Y42j4kb33)
- Agent/platform: Sisyphus (`anthropic/claude-opus-5-5`) / Linux
- Repository: `/home/nowaker/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `fix-plugin-tool-import`
- Upstream base: `006d837c50` (`v1.19.5`)
- Source result commit(s): `5f86d0f2600ea72e4b8e10d69141c71a346f2c3d`
- Forklog commit: this file's introducing commit

## User requests

The coordinator's request was to record the Nov 21 daily PR drain and push it to both fork mirrors:

> Record verified daily PR drain in the forklog via your established worktree/commit/both-mirrors workflow.

The GitHub pre-push hook refused that push, so the fix below was needed to finish it.

## Goals

- `packages/plugin` typechecks again, so `dev-nowaker` can be pushed to `nowaker-github`.

## Constraints and non-goals

- No behavior change: the fix only corrects an import specifier.
- The auto-switch work that introduced the import (`a9d458075e`, [`ses_e042fa91bffecOvYIQCsl4mxhD`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e042fa91bffecOvYIQCsl4mxhD)) is otherwise unchanged.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `d451258f0d` | `5f86d0f260` | commit, landed with `vibeterm_worktree_land` |

## Features touched

None. The change restores the build of the plugin package added to by `a9d458075e`.

## Other delivered work

- `packages/plugin/src/tool.ts`: `import type { AutoSwitchContext } from "./index"` became `"./index.js"`. The package compiles with `moduleResolution: "nodenext"`, which requires explicit extensions on relative imports; every other relative import in the package already used `.js`. Without it the typecheck failed with TS2835 and the pre-push hook refused every `dev-nowaker` push to GitHub.

## Verification

- `bun run typecheck` in `packages/plugin` of the worktree - exit 0 (the pre-push hook had shown TS2835 on the same file before the fix).
- `git push nowaker-github dev-nowaker` - the hook passed 30/30 typecheck tasks; `git ls-remote` showed `5f86d0f260` on both `origin` and `nowaker-github` at 2026-11-21T07:02:20Z.

## Build and install

- Build command: not run.
- Installed artifact: not installed.
- Running services: not applicable.

## Commit provenance

- `5f86d0f2600ea72e4b8e10d69141c71a346f2c3d` - import extension fix.
- Required trailer: `AI-Session-ID: ses_eeda1d251ffel81U5Y42j4kb33`

## Historical evidence carried forward

- The November 25 weekly audit listed `5f86d0f260` as a commit without a behavioral forklog record; this file closes that gap.

## Unknowns and blocked verification

- None.
