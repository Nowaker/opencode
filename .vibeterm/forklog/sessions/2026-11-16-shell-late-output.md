# Keep a fast command's output for readers that attach late

## Identity

- Workday: 2026-11-16
- Session: [`ses_e1bb77423ffeFABSFtCGeavd1T`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e1bb77423ffeFABSFtCGeavd1T), OpenCode / darwin on m4max
- Coordinator: [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv)
- Repository: `/Volumes/projects/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `shell-output-race` (fork); `keep-late-output` (upstream head)
- Upstream base: `006d837c50` (`v1.19.5`); upstream head cut from `v1` at `6a5339d0661`
- Source result commit(s): `1a4cba2fbef` on `dev-nowaker`; `7f1c045d29f` on `keep-late-output`
- Forklog commit: this file's introducing commit

## User requests

> BUG: the bash/shell tool can silently drop a fast command's stdout. The model and the UI get "(no output)" for a command that printed and exited 0.

> Test first: a test that runs a fast command (prints, exits immediately) through the REAL spawner and ShellTool path, many iterations, and asserts the full output arrives every time, including the running-part metadata.output. It must fail reliably on the current code; pin the race deterministically (for example, hold the child's exit until the reader would otherwise attach late), not with timing luck. No fixed sleeps as the fix or in the test.

> Upstream: anomalyco/opencode has the same bug. Cut a branch from upstream v1 with the same test and fix, push it to nowaker-github, and write the PR title and body into the fork's .vibeterm/forklog/pr-queue/ in its existing convention [...] Don't open it; the daily PR drain files it when a slot frees.

## Goals

- Fast commands return their output through the bash tool every time, with the running-part `metadata.output` update.
- The same fix is ready for upstream `v1`.

## Constraints and non-goals

- `dev-nowaker` is merge-only; one build per host, slots coordinated with [`ses_e383ee7faffe6JX8m2EP26dXUC`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e383ee7faffe6JX8m2EP26dXUC) and the shared desktop builder [`ses_e1c704309ffe9QEvj69IIxmKNZ`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e1c704309ffe9QEvj69IIxmKNZ). No tab or service restarts.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `Nowaker/opencode` (GitLab and GitHub) | `dev-nowaker` | `6305b4bfa7d` | `1a4cba2fbef` | rebase of `shell-output-race` and fast-forward through `vibeterm_worktree_land`; both tips verified |
| `Nowaker/opencode` (GitLab and GitHub) | `keep-late-output` | - | `7f1c045d29f` | new branch from `anomalyco/opencode` `v1` `6a5339d0661`; both tips verified |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Keep a fast command's output for readers that attach late](../features/2026-11-16-shell-late-output.md) | introduced | core and opencode tests, installed real check |

## Root cause

- Node and Bun discard what a child wrote to a stdio pipe with no data listener once the child exits. A probe that waited for `close` before touching `stdout` found it ended, destroyed and empty on both runtimes.
- `CrossSpawnSpawner.setupOutput` returned lazy `NodeStream.fromReadable` streams over the bare pipes. `ShellTool` forks its reader after `spawn()` returns, so a child that exited first lost its output.
- Upstream `v1` has a second half: its `ShellTool` closes the reader's scope as soon as the exit is reported. The fork joins the reader there already (`5cc30c46fbc`). Upstream `v2` fixed the spawner half in [#46463](https://github.com/anomalyco/opencode/pull/46463).

## Verification

- `packages/core`: the new late-reader test failed on the old spawner (stdout and stderr read `""`); after the fix `bun test` passes 1218/1218 with a system `TMPDIR`. With `TMPDIR` inside the checkout, 17 "non-git directory" fixtures fail on both old and new code, because the scratch directory then sits inside a git repository.
- `packages/opencode`: the new ShellTool test returned `(no output)` on the old spawner and passes after; 496/496 across the tool, project, snapshot, git, mcp, format, prompt and installation suites with a system `TMPDIR`.
- `bun typecheck` passes in both packages; Prettier is clean.
- Upstream head: core spawner tests 26 pass, `test/tool/shell.test.ts` 24 pass, both typechecks pass. The ShellTool test fails with only the spawner half and with only the ShellTool join.
- Manual surface: on m4max, vt-511 `opencode run` with `anthropic/claude-haiku-5-5` made four bash calls (`echo realcheck-1`, `echo realcheck-2`, `printf 'realcheck-3\n'`, `echo realcheck-4 >&2`). All four parts in `opencode.db` have status `completed`, exit 0, and the text in both `state.output` and `state.metadata.output`. The scratch session `ses_e1b87fd86ffelARcR3ClJpi5ZE` was deleted afterwards (0 session and 0 part rows remain).
- Manual surface, desktop: vt-512 `opencode run` with the same prompt (stdin from `/dev/null`; an ssh-inherited open stdin made the first attempt hang until its timeout). The model made seven bash calls, repeating the first three; all seven parts in desktop's `opencode.db` have status `completed`, exit 0, and the text in both `state.output` and `state.metadata.output`. The scratch session `ses_e1b1d4b2fffefzzjwHGkuGO19I` was deleted (0 session and 0 part rows remain).

## Build and install

- m4max: `.vibeterm/build.sh` at 12:58:57-12:59:25Z, v2 guard gate PASSED, installed `1.19.5-vt-511-006d837c50`; `.vibeterm/smoke.sh`: SMOKE OK. The build ran during the [`ses_e1c8c5894ffev5AZef6yecmm4P`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e1c8c5894ffev5AZef6yecmm4P) benchmark and replaced its vt-510; that session kept vt-510 as a pinned artifact and discards the overlapping samples.
- desktop: the shared idle-priority build by `ses_e1c704309ffe9QEvj69IIxmKNZ` from `3f11da6da68` (contains `1a4cba2fbef`), 14:34:45-14:54:52Z, v2 guard gate PASSED 8/8, installed `1.19.5-vt-512-006d837c50`. This session ran `.vibeterm/smoke.sh` against it: SMOKE OK.
- Running services: not restarted.

## Other delivered work

- pr-queue entry [`10-shell-late-output.md`](../pr-queue/10-shell-late-output.md).

## Commit provenance

- `1a4cba2fbef` - fork fix and tests
- `7f1c045d29f` - upstream head
- Required trailer: `AI-Session-ID: ses_e1bb77423ffeFABSFtCGeavd1T`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-11-16-shell-late-output.md
```

## Unknowns and blocked verification

- None.
