# Snapshot store index.lock wait

## Identity

- Workday: 2026-11-10
- Session: [`ses_e3b674d77ffe6z70yBg7vCW6nj`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3b674d77ffe6z70yBg7vCW6nj) (spawned by coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv))
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (`high`) / `linux`
- Repository: `~/projekty/webapps/opencode`; m4max `~/projects/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `snapshot-index-lock`; upstream twin `snapshot-lock-upstream`
- Upstream base: `006d837c50` (`v1.19.5`)
- Source result commit(s): `aeaa71c967`, `29e7545775`, merge `3b0f177f0b`; upstream twin `ec838f8fcf`, `10c014b816`
- Forklog commit: this file's introducing commit

## User requests

From the coordinator, user approval [`qst_1aaf2cbbd001dAKyiwxju7twtX`](https://portal.vibeterm.desktop.ts.nowaker.net/question/qst_1aaf2cbbd001dAKyiwxju7twtX) "Fix the index.lock race":

> WANTED: in the snapshot code (packages/opencode/src/snapshot/), retry `git add` / `write-tree` (and any other index-writing step) with a short, bounded backoff with jitter when the failure is a held index.lock owned by another process. Never delete a lock. Log the retries, and give up with today's behaviour once the budget is spent. Add a test that fails on the old code: two concurrent snapshot writers on the same store both produce a snapshot. Then, if the fix is clean against github/v1, prepare an upstream branch and a PR body under .vibeterm/tmp/opencode/, but don't open a PR (we're at the 3-PR cap).

## Goals

- Snapshot git calls wait out another process's `index.lock`; tests red on the old code; an upstream branch and PR body ready.

## Constraints and non-goals

- No PR opened (3-PR cap).
- The main checkout's uncommitted retry-header cap (`retry.ts`, `retry.test.ts`) and `.gitignore` edit were preserved; both builds ran from the main checkouts, so vt-419 carries the cap.
- Concurrent workers on `dev-nowaker`: perm-defer (`365d0a3b4d`) was merged under this work; file-metadata (`9911a26b09`) landed above it before this record. vt-419 was built from `3b0f177f0b` and does not contain file-metadata.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `365d0a3b4d` | `3b0f177f0b` | merge `snapshot-index-lock`; pushed to `origin` and `nowaker-github` |
| `opencode` | `snapshot-lock-upstream` | - | `10c014b816` | new branch on `github/v1`, pushed to `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Wait for an index.lock another process holds in the snapshot store](../features/2026-11-10-snapshot-index-lock.md) | added | snapshot and spawner tests, red on the old code |
| [Send the model request while file snapshots run](../features/2026-11-01-async-snapshots.md) | follow-up | fixes the hashless steps its 2026-11-05 reliability check traced to `index.lock` |

## Other delivered work

- Spawner fix in `packages/core`: a child that closes stdin unread no longer causes an uncaught `EPIPE`, found when the retry test crashed the runner.

## Verification

- See the [feature record](../features/2026-11-10-snapshot-index-lock.md#verification): snapshot suite 69 pass / 1 skip on merged `dev-nowaker`, spawner suite 25 pass, both new snapshot tests fail on the old `index.ts` (5 of 5) and the spawner test on the old spawner (3 of 3), typechecks clean; the upstream twin reproduces the same red/green on `github/v1`.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh` on desktop and m4max (m4max after `bun install --frozen-lockfile`, with `/opt/homebrew/bin` on `PATH`).
- Installed artifact: `1.19.5-vt-419-006d837c50` on both hosts; desktop inode `49972305`, m4max inode `56258955`; v2 guard gate passed; retry marker and `snapshot index.lock held by another process, retrying` present in both binaries; `.vibeterm/smoke.sh` SMOKE OK on both.
- Running services: not restarted.

## Commit provenance

- `aeaa71c967` - spawner fix; `29e7545775` - snapshot fix; `3b0f177f0b` - merge.
- Required trailer: `AI-Session-ID: ses_e3b674d77ffe6z70yBg7vCW6nj`

The record cannot contain its own eventual commit hash. Resolve it with:

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-11-10-snapshot-index-lock.md
```

## Live check 2026-11-13

Measured by coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv) over 2026-11-10T10:00Z to 2026-11-13T10:00Z, with the 2026-11-05 method (`opencode.log`, its draining files and the daily archives, deduplicated; finished assistant messages in 12-hour chunks through `vt_message_time_created_id_idx`).

| | desktop | m4max |
|---|---|---|
| `index.lock` collisions (first retry, `attempt=1`) | 367 | 78 |
| ... that ended in `still held, giving up` | 4 | 0 |
| `failed to add snapshot files` naming `index.lock` | 1 | 0 |
| `snapshot failed` | 0 | 0 |

- Desktop DB: 83,578 step-finish parts, 120 without a hash (0.144%, against 0.31% in the 2026-11-05 window A). 114 of the 120 are in scratch and demo directories (`~/projekty/tmp/vibeterm/opencode-omo-demos`, `/tmp/...`, `~/projekty/tmp/vibeterm/perm-op13`); the other 6 are 4 in `~/projekty/dreamhost`, 1 in `~/projekty/modern/worldmodern` and 1 in one more session.
- Not a lock failure: 926 of desktop's 940 `failed to add snapshot files` lines (2026-11-11 03:00Z to 2026-11-12 06:22Z) are `'tmp/w4-proof-FFDPTt/project/' does not have a commit checked out`, a scratch repository with no commit nested in `opencode-omo-demos`. One such embedded repository makes every snapshot `git add` in that worktree fail.
- Verdict: the retry turns almost every collision into a settled snapshot, with no regression. The upstream branch `snapshot-lock-upstream` stays queued as `pr-queue/03-snapshot-lock.md`.

## Unknowns and blocked verification

- None for the lock retry. The embedded-repository `git add` failure above is a separate, unfixed issue.
