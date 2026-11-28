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

TBD - reported by the Meridian coordinator (ses_fe8a27c6effe6KEx3TRNvOLgUo) after its worker ses_dea3e4c74ffe1TSOb1yhZiOtoh could run no tool except read/todowrite for about 10 minutes ("Snapshot preflight failed; the tool was not started"). Assigned by the OpenCode coordinator (ses_ef8235798ffejGr4sa22eXmVNv); built by ses_ddf82df2dffeRbBVQffAx0OAKK.

## Goals

- A nested repository never makes a snapshot op fail: snapshot diff/status commands run with `--ignore-submodules=all`.
- Private-index entries that the synced excludes now cover are removed, and a gitlink whose path became an ordinary file is evicted so the file is captured.
- After three consecutive failed snapshot preflights in a session, a write tool runs without file undo (the existing 120 s no-undo path from `cad4ee8bd6`) and the session sees a synthetic warning part; a healthy capture resets the count.

## Non-goals

- Traversing or repairing nested repositories; their checkout state is left untouched.

## Rationale and constraints

- Cause: the snapshot store for a project kept gitlinks under `tmp/worktrees/` written while those worktrees existed; an exclude does not remove tracked entries, so `diff-files` recursed into a Vibeterm-retired worktree whose gitdir carries guard extensions and exited 128.
- Snapshot-warning parts are excluded from doom-loop detection.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `06ee635ec2` | 2026-11-28 | Recover from stale nested repository gitlinks | `snapshot/index.ts` |
| `8a55d23eeb` | 2026-11-28 | Allow tools after repeated preflight failures | `session/processor.ts`, `session/tools.ts` |

## Verification

- hania-arch, MemoryMax 6G: red at `b37f07343f` 3 pass / 4 expected fails (diff-files exit 128 on the unknown extension); green `bun typecheck` and 146 pass / 1 skip / 0 fail across snapshot, preflight, tools, async-snapshot, processor, revert-compact and snapshot-tool-race. Reviewed by ses_ef8235798ffejGr4sa22eXmVNv.
