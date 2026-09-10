# Watcher EMFILE wedge

## Identity

- Workday: 2026-09-09
- Session: `ses_f76ce0cf6ffejNGTCJyk7ooYc5`
- Agent/platform: `Sisyphus - ultraworker` / `darwin`
- Repository: `/Volumes/projects/webapps/opencode` (macOS checkout of the fork)
- Integration branch: `master-nowaker`
- Development branch(es): `watcher-emfile-degrade`, in the linked worktree
  `/Volumes/projects/webapps/opencode-wt-watcher`
- Upstream base: `a9a6fad0f` (upstream `dev`; upstream published no release tag
  after `v1.18.29`)
- Source result commit(s): `84b8fcdfe` (upstream-based), `34aa414cf`
  (cherry-picked onto `master-nowaker`)
- Forklog commit: this file's introducing commit

## User requests

> TASK: Fix a proven opencode defect where an `inotify_init1` EMFILE silently
> wedges every prompt turn forever. Author it as an upstream-quality patch
> against upstream's default branch, then integrate it into `master-nowaker`.

> The fix, minimal and upstream-appropriate. The defect is the silent
> non-settling failure, so the fix must at minimum make watcher creation
> failure OBSERVABLE and NON-FATAL

> Do NOT paper over it with a blanket timeout if the real failure is a
> droppable error; a timeout is a fallback, not the fix.

## Goals

- A prompt turn completes when the kernel refuses an inotify instance.
- The refusal is visible in the log with its errno.
- The patch applies to current upstream `dev` so it can be offered upstream.

## Constraints and non-goals

- The `upstream` remote was not configured; a stale `refs/remotes/upstream/dev`
  existed. Added `https://github.com/anomalyco/opencode.git` as `upstream` with
  its push URL disabled, and fetched `dev`.
- The retry-header delay cap had to stay an uncommitted divergence, byte-identical
  to its canonical patch, throughout.
- `.gitignore` carries a `+.opencode/` line written by a parallel session in the
  same checkout. Left unstaged and uncommitted.
- No protected serve unit and no vibeterm tmux server was restarted. Nothing was
  installed: the desktop's `~/projekty/webapps/opencode-build/bin/opencode` was
  read and executed but never replaced.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `upstream/dev` | `5cd8e68fd` (stale local ref) | `a9a6fad0f` | fetch |
| `opencode` | `watcher-emfile-degrade` | - | `84b8fcdfe` | branch off `a9a6fad0f`, one commit |
| `opencode` | `master-nowaker` | `d6999df68` | `34aa414cf` | cherry-pick |
| `opencode-tools` | `master` | `123ec5e1` | `e668ee37` | commit |

No upstream merge was performed: `master-nowaker` still integrates upstream at
`5cd8e68fd`. The fix was authored on `a9a6fad0f` and cherry-picked, because
`packages/core/src/filesystem/watcher.ts` was byte-identical between the two.

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Watcher inotify preflight](../features/2026-09-09-watcher-inotify-preflight.md) | introduced | `34aa414cf`; `bun test` 8 pass in `packages/core` |
| [Retry-header delay cap](../features/2026-08-06-retry-header-delay-cap.md) | preserved | working-tree diff byte-identical to `retry-header-delay-cap.patch` before and after the cherry-pick; `bun test test/session/retry.test.ts` green |

## Other delivered work

- `opencode-tools` `e668ee37` records
  `docs/opencode-patches/watcher-inotify-preflight.patch` and documents that,
  unlike the retry cap, this divergence is committed and survives upstream
  merges on its own.

## Verification

- `bun typecheck` in `packages/core` on `master-nowaker` - exit 0.
- `bun typecheck` in `packages/opencode` on `master-nowaker` - exit 0.
- `bun test test/filesystem/watcher.test.ts test/filesystem/watcher-preflight.test.ts`
  in `packages/core` - 8 pass, 0 fail.
- `bun test test/session/retry.test.ts test/plugin/codex.test.ts test/session/system.test.ts`
  in `packages/opencode` - 111 pass, 0 fail.
- Red state: replacing `const failure = probe?.()` with `const failure =
  undefined` makes the new regression fail, reporting that both the root and
  `.git` were subscribed and no warning was logged. Restored afterwards.
- Manual surface, nwkr-desktop, real inotify exhaustion (841 instances held
  until `inotify_init1` returned `EMFILE`), real
  `@parcel/watcher-linux-x64-glibc` binding:

  | Call | Observed |
  |---|---|
  | probe, no pressure | `undefined` |
  | probe, exhausted | `{"errno":24,"code":"EMFILE"}` |
  | unguarded `subscribe()`, exhausted | printed `calling subscribe()`, never executed the next statement, killed at 20s (exit 137) |
  | guarded `subscribe()`, exhausted | logged the errno, exit 0 in 0s |
  | probe, after release | `undefined` |

  This exercises the exact thread that parks, so it establishes both the defect
  and the fix. It does not establish the whole-turn behaviour; see below.

## Build and install

- Build command: not run. No binary was produced or installed on either host.
- Installed artifact: unchanged. `~/projekty/webapps/opencode-build/bin/opencode`
  remains the 1.18.31 build from the previous session.
- Running services: untouched; no unit was restarted or inspected for restart.

## Commit provenance

- `84b8fcdfe` - upstream-based fix on `watcher-emfile-degrade`.
- `34aa414cf` - the same change on `master-nowaker`.
- `e668ee37` - patch record in `opencode-tools`.
- Required trailer: `AI-Session-ID: ses_f76ce0cf6ffejNGTCJyk7ooYc5`

The record cannot contain its own eventual commit hash. Resolve it with:

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-09-09-watcher-emfile-wedge.md
```

## Historical evidence carried forward

- The trigger was environmental, not opencode's: a stale KDE `KLockFile` naming
  a pid dead since 2026-09-04 produced a 31-deep `.lock.rmlock.rmlock…` chain,
  so the `DXejRj` sycoca variant could never rebuild and every KDE caller
  spawned another `kbuildsycoca6` that never exited - 2552 of them, 954 holding
  an inotify instance each, at 753 new per 5 minutes. Clearing the chain and the
  herd took inotify from 1022/1024 to 267/1024. opencode's defect is that it
  converted somebody else's exhaustion into a permanent silent wedge.
- Prior probe evidence from the reporting session: the turn died between
  `PROBE p5a skills done` and `p5b environment done`, i.e. inside
  `SystemPrompt.environment`, and a 90s hung run issued exactly one provider
  request - the title subagent - with no request for the main model.

## Unknowns and blocked verification

- Whole-turn acceptance (`opencode run` completing under exhaustion on a fixed
  binary) was NOT established. `opencode run` on nwkr-desktop does not complete
  even with inotify free and no fix applied: 301s in a fresh git directory,
  120s with `--pure`, and 90s with `--pure` in an already-known project, all
  killed by timeout. The same box logged
  `ERROR ... message=process ... error="Failed to execute statement"` from a
  live session while roughly twenty opencode processes shared the database.
  That failure is unrelated to the watcher and predates the fix, so the box
  currently provides no working instrument for a whole-turn before/after. Not
  investigated; out of scope for this session.
- Consequently no Linux binary containing the fix was built or exercised. The
  fix is established at the native boundary and by the unit regression only.
