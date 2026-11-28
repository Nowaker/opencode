# Stale snapshot gitlinks no longer block tools

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `snapshot-gitlink-recovery`
- First local commit: `06ee635ec2`
- Current local commit(s): `06ee635ec2`, `8a55d23eeb`; merge `90fcc8d110`
- Upstream base when introduced: `006d837c50` (v1.19.5)
- Last checked against upstream: `006d837c50`

## Original request

TBD - reported by the Meridian coordinator (ses_fe8a27c6effe6KEx3TRNvOLgUo): its worker ses_dea3e4c74ffe1TSOb1yhZiOtoh could run no tool but read/todowrite for about 10 minutes ("Snapshot preflight failed; the tool was not started"). Assigned by ses_ef8235798ffejGr4sa22eXmVNv; built by ses_ddf82df2dffeRbBVQffAx0OAKK.

## Goals

- A snapshot store whose private index still holds a gitlink to a nested repository git refuses (a Vibeterm-retired worktree with guard extensions) no longer makes snapshot ops fail.
- Snapshot diff operations run with `--ignore-submodules=all`; entries the synced excludes now cover are removed from the private index; a gitlink whose path became an ordinary file is evicted so the file is captured.
- After three consecutive failed snapshot preflights in a session, a write tool runs without file undo (the existing 120 s no-undo path) and the session gets a synthetic warning part; a healthy capture resets the count.

## Non-goals

- Changing nested repository checkouts or recording their contents.

## Rationale and constraints

- An exclude does not remove already-tracked index entries, so stale gitlinks persisted after `tmp/` was excluded and `diff-files` recursed into them.
- The warning part is excluded from doom-loop detection.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `06ee635ec2` | 2026-11-28 | Recover from stale nested repository gitlinks | `snapshot/index.ts` |
| `8a55d23eeb` | 2026-11-28 | Allow tools after repeated snapshot preflight failures | `session/processor.ts`, `session/tools.ts` |

## Verification

- hania-arch, MemoryMax 6G: red at `b37f07343f` 3 pass / 4 expected fail (real `diff-files` exit 128 fixtures); green 146 pass / 1 existing skip / 0 fail across 11 files, `bun typecheck` exit 0, Linux single build smoke. Reviewed by ses_ef8235798ffejGr4sa22eXmVNv.
