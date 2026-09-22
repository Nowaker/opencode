# 2026-09-22 - rebuild the fork as `dev-nowaker` on upstream `dev`

## Identity

- Workday: 2026-09-22
- Session: `ses_fb9a784deffe7zkW0r8oo25Nkg`
- Agent/platform: OpenCode through Vibeterm, `anthropic/claude-opus-5-5` / Linux
- Repository: `/home/nowaker/projekty/webapps/opencode`
- Related tooling: `/home/nowaker/projekty/nowaker/opencode-tools`,
  `/home/nowaker/projekty/webapps/opencode-build/build.sh`
- Integration branch: `dev-nowaker` (replaces `master-nowaker`)
- Development branch(es): direct integration work
- Prior upstream base: `5cd8e68fd` (upstream `dev`, post-`v1.18.29`)
- Upstream base: `2406400f0` (upstream `dev`; contains `f5ce4f881`, the parent
  of the `v1.18.32` release commit)
- Source result: 37 replayed commits, `github/dev..7946757514`
- Forklog commit: resolve this file's introducing commit through its
  `AI-Session-ID` trailer

## User requests

> bump opencode, reintegrate main-nowaker to be up to date. start from
> origin/dev, name as dev-nowaker. once proved successful make it the primary
> checkout, and the target for all subsequent builds/bumps.
> don't mess up oc version. this is the latest version:
> https://github.com/anomalyco/opencode/releases/tag/v1.18.32
> so ours should be 1.18.32 too, and not .34 as advertised now.
> ...while being hundreds of commits behind!
> must get dev-nowaker up to date with dev.

> let's always push to my gitlab and github for consistency.

## Goals

- A fork branch that is zero commits behind upstream `dev`.
- Every local customization carried forward unchanged.
- The installed binary reports the upstream release it actually contains.

## Constraints and non-goals

- Do not restart a protected OpenCode serve process.
- Keep the retry-header cap as the canonical uncommitted two-file divergence.
- Leave foreign working-tree changes in the primary checkout untouched.

## Why a replay instead of another merge

`master-nowaker` accumulated ten upstream merges. GitHub compared it with
upstream `dev` as 8 ahead and 683 behind, because merge commits do not make a
branch's history look current. `dev-nowaker` starts at upstream `dev` and
cherry-picks (`-x`) the 37 first-parent non-merge commits of `master-nowaker`
in order, so it is linear and zero behind.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| OpenCode | `dev-nowaker` | new | `7946757514` + this record | 37 cherry-picks onto `2406400f0` |
| OpenCode | `master-nowaker` | `e32261106e` | `e32261106e` | Retired; kept as history |
| OpenCode origin + GitHub fork | `dev-nowaker`, `master-nowaker` | mixed | equal on both | Publish to both remotes |

## Replay evidence

- One conflict: `20a24f2eb` (global memory endpoint) against upstream's rewrite
  of `httpapi/handlers/global.ts`. No later pick touched that file, so it was
  resolved from the tree `git merge-tree --write-tree master-nowaker github/dev`
  produced cleanly.
- The replayed tip's tree equals that merge tree exactly
  (`aae6ae33ffa91959c1ee4c9074f1565746c8b881`), so the replay changed nothing a
  merge would have kept.

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Global memory diagnostics](../features/2026-05-13-global-memory-diagnostics.md) | preserved | conflict resolved from the merge tree; typecheck 30/30 |
| [Message shape normalization](../features/2026-05-23-message-shape-normalization.md) | preserved | shape-stability test in the 166-test gate |
| [Interrupted assistant tail](../features/2026-05-29-interrupted-assistant-tail.md) | preserved | `session/prompt.test.ts` in the 166-test gate |
| [Sync hot path](../features/2026-05-29-sync-hot-path.md) | preserved | typecheck 30/30 |
| [Alternate provider clones](../features/2026-05-30-alt-provider-clones.md) | preserved | typecheck 30/30 |
| [Compaction tracing](../features/2026-06-16-compaction-decision-tracing.md) | preserved | typecheck 30/30 |
| [Global bus typing](../features/2026-07-21-global-bus-typing.md) | preserved | typecheck 30/30 |
| [Retry-header cap](../features/2026-08-06-retry-header-delay-cap.md) | reapplied | canonical patch applies; `retry.test.ts` passes; binary marker 1 |
| [Native tool commands](../features/2026-08-08-native-tool-commands.md) | preserved | `test/command/` in the 166-test gate |
| [TUI stream throttle](../features/2026-08-25-tui-stream-throttle.md) | preserved | `use-event.test.tsx` in the 25-test TUI gate |
| [Prompt input latency](../features/2026-08-31-prompt-input-latency.md) | preserved | `prompt/display.test.ts` in the 25-test TUI gate |
| [Watcher inotify preflight](../features/2026-09-09-watcher-inotify-preflight.md) | preserved | `watcher-preflight.test.ts` in the 24-test core gate |
| [Session replacement maintenance](../features/session-maintenance.md) | preserved | `session-maintenance*` tests in the 24-test core gate |

## Other delivered work

- `opencode-build/build.sh` stamps the newest release HEAD contains: the
  highest `vX.Y.Z` tag whose release commit's parent is an ancestor of HEAD. It
  no longer adds one patch version. Upstream cuts each release as a single
  `release:` commit on top of `dev`, so the tag is never an ancestor of `dev`
  itself. Under the old rule `master-nowaker` stamped `1.18.34` while containing
  only `v1.18.30`; `dev-nowaker` now stamps `1.18.32`.
- `build.sh` honors `OPENCODE_SRC` so a worktree can be built before it becomes
  the primary checkout.

## Verification

- `bun turbo typecheck` - 30 successful, 30 total.
- `packages/core`: watcher preflight and all `session-maintenance*` tests -
  24 pass / 0 fail.
- `packages/opencode`: `retry.test.ts`, `test/command/`, `session/prompt.test.ts`,
  `plugin-composer.test.ts`, message-shape stability - 165 pass / 0 fail.
- `packages/tui`: `use-event`, `sdk`, `prompt-control`, `prompt/display` -
  25 pass / 0 fail.
- Manual surface: the installed binary ran `opencode run` to a completed turn
  with exit 0.

## Build and install

- Build command: `OPENCODE_SRC=<dev-nowaker worktree> opencode-build/build.sh`.
- Artifact: `/home/nowaker/projekty/webapps/opencode-build/bin/opencode`,
  version `1.18.32`, device/inode `64768:49958477`, size `161172584`; one
  `OPENCODE_RETRY_MAX_HEADER_DELAY_MS` marker.
- Predecessor archived at `bin/opencode.prev-1790120531` (stamped `1.18.34`).
- Running services: `opencode-serve-tailscale` PID `2253533` and
  `opencode-serve-lan` PID `2253256` kept their 2026-09-21 16:36 start times
  across the build. Neither was restarted.

## Commit provenance

- `github/dev..7946757514` - 37 cherry-picks, each with an `-x` origin line.
- This record's commit carries `AI-Session-ID: ses_fb9a784deffe7zkW0r8oo25Nkg`.

## Unknowns and blocked verification

- `bun install` ran under local Bun `1.4.0` against the pinned `bun@1.3.14`, as
  on 2026-09-08. The replayed lockfile stayed clean.
- The macOS host was not rebuilt in this session.
