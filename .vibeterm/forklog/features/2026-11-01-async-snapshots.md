# Send the model request while file snapshots run

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `async-snapshots` (upstreamable, on `github/v1`; pushed to `nowaker-github`), merged through `async-snapshots-merge`
- First local commit: `5890ad1411`
- Current local commit(s): `5890ad1411`, merge `6977deacde`
- Upstream base when introduced: `006d837c50` (`v1.19.5`, `github/v1`)
- Last checked against upstream: `006d837c50`

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, which recorded the user's approval as "Build async snapshots":

> Task: make opencode's per-turn snapshots asynchronous in our fork, as an upstreamable change. The user approved this design ("Build async snapshots").

## Goals

- Start each step's file snapshot in the background and send the model request at the same time.
- Tools that may write wait for every snapshot the session has started; read-only built-ins and the next model request do not.
- Take the step-finish snapshot and patch off the critical path the same way.
- Diffs (`summary.diffs`), Modified Files (patch parts) and undo (revert) stay identical to synchronous snapshots.

## Non-goals

- No config switch. Upstream would not want a second code path for behavior that is observably identical.
- No change to the snapshot store itself.

## Rationale and constraints

- Measured per-turn cost on desktop averaged ~398 ms; a pathological worktree took 25-36 s per snapshot. The request waited for all of it.
- Invariant: no tool that may modify the worktree starts executing until every snapshot the session has started has finished. `SessionTools.resolve` calls `Handle.waitForSnapshots` before such a tool runs, ahead of `tool.execute.before` hooks.
- Classification lives in one place, `ToolRegistry`, keyed by built-in definitions. Read-only: `read`, `glob`, `grep`, `webfetch`, `websearch`, `todowrite`, `question`, `skill`, `lsp`, `plan_exit`, `invalid`. Everything else waits: shell, edit, write, apply_patch, code mode, every plugin, MCP and MCP-resource tool, a custom tool reusing a built-in name, and `task` (subagents edit the same worktree and their changes belong to the parent step's diff).
- `step-start`, `step-finish` and `patch` parts are written when their event arrives and get their hash when the snapshot finishes; the patch part ID is allocated at step end so part order is unchanged. The summary runs after both hashes exist.
- `SessionPrompt.loop` settles pending snapshots before returning and on abort or failure, so the session stays busy until the hashes exist and revert (which requires a non-busy session) never sees a finished step without them. A write-capable tool released after an abort does not start.
- Fork-only adaptation in the merge: the fork's `ToolTimeout.guard` would count the snapshot wait against a tool's time limit, so the wait runs inside `call.hold`. Snapshot calls pass `sessionID` for snapshot housekeeping.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `5890ad1411` | 2026-11-01 | Background snapshots per session, gate, settled hashes | `SessionProcessor.Handle.waitForSnapshots`, `SessionProcessor.Interface.settle`, `processor.ts` `background`/`recordPatch`, step-start/step-finish/cleanup handlers |
| `5890ad1411` | 2026-11-01 | Read-only classification | `Tool.Def.readOnly`, read-only list in `ToolRegistry` state, `readOnly` in `registry.tools()` output |
| `5890ad1411` | 2026-11-01 | Gate before tools that may write | `beforeWrite` in `session/tools.ts` |
| `5890ad1411` | 2026-11-01 | Loop settles snapshots | `SessionPrompt.loop`, end of `runLoop` |
| `5890ad1411` | 2026-11-01 | Tests | `test/session/async-snapshot.test.ts`, registry test `marks only read-only built-in tools as not waiting for snapshots` |
| `6977deacde` | 2026-11-01 | Fork merge: `call.hold` around the wait, `sessionID` on snapshot calls | `beforeWrite(options, call)`, `snapshot.track(sessionID)` / `snapshot.patch(hash, sessionID)` in `processor.ts` |

## Verification

See [the session record](../sessions/2026-11-01-async-snapshots.md#verification).

## Timeline

- 2026-11-01 [`ses_e6649eb52ffeWA5U81qVUQP5Td`](../sessions/2026-11-01-async-snapshots.md) - initial build on `github/v1`, merge into `dev-nowaker`, install on desktop and m4max. Evidence: `5890ad1411`, `6977deacde`.
- 2026-11-05 [`ses_e552a0970ffenpqGnyRp4OwJE1`](../sessions/2026-11-05-async-snapshot-reliability.md) - 3-day reliability check on desktop and m4max, read-only: no regression in the async code, no source change. See [Reliability check 2026-11-05](#reliability-check-2026-11-05).
- 2026-11-10 [`ses_e3b674d77ffe6z70yBg7vCW6nj`](../sessions/2026-11-10-snapshot-index-lock.md) - follow-up, no change to this feature: the hashless steps traced to cross-process `index.lock` collisions are addressed by [Wait for an index.lock another process holds in the snapshot store](./2026-11-10-snapshot-index-lock.md). Evidence: `29e7545775`, merge `3b0f177f0b`.

## Reliability check 2026-11-05

Window A is 2026-11-02 03:00Z to 2026-11-05 08:35Z (vt-391 and later); window B is 2026-10-29 21:12Z to 2026-11-02 02:45Z (synchronous snapshots). Logs are desktop `opencode.log`, its draining file and the daily archives; the DB is desktop `opencode.db`, finished assistant messages bucketed by `time_created` through `vt_message_time_created_id_idx` and `part_message_id_id_idx`. No project in either window had snapshots disabled: every project's step-start parts carry hashes.

Verdict: reliable. Zero `snapshot failed` lines (the background-crash log in `processor.ts` `background`) on either host, zero revert or restore errors, and no user report of undo, Modified Files or diffs going wrong since 2026-11-02.

| Desktop | B | A |
|---|---|---|
| `snapshot op` track n / not ok / p50 / p95 / max ms | 26,885 / 24 / 40 / 353 / 87,329 | 107,060 / 1,088 / 974 / 5,032 / 821,751 |
| `snapshot op` patch n / not ok / p50 / p95 ms | 13,434 / 2 / 24 / 121 | 53,460 / 395 / 47 / 989 |
| `failed to add snapshot files` | 6 | 203 (196 `index.lock` exists) |
| `failed to list snapshot files` | 0 | 1,056 (all `vibeterm-retired-worktree` repository extension, 4 processes, 11-02 23Z to 11-03 02Z) |
| `snapshot failed` / revert errors | 0 / 0 | 0 / 0 |
| loop to `stream` log, p50 / p95 / p99 ms | 530 / 3,392 / 33,968 (n 14,900) | 515 / 3,466 / 28,198 (n 54,510) |
| Finished assistant messages | 11,082 | 56,832 |
| step-start without hash | 0 | 8 |
| step-finish without hash | 0 null, 6 stored as `""` | 179 null (0.31%) |
| first write tool started before its step-start hash was written | 7 of 8,343 | 111 of 40,651 (84 over 1 s, 35 over 10 s) |
| turns with a patch but empty or missing `summary.diffs` | 1 of 358 | 26 of 3,387 |

- `snapshot op` duration is wall time from call to result, including the in-process store lock and the event loop. Raw `git diff-files` and `ls-files --others` on this repository's store take 4-9 ms, while a `files=0` track logs 300-480 ms. The git work now overlaps request preparation on the same event loop, so the logged duration rose about 25x without delaying the request: loop-to-stream time did not grow.
- A step-finish without a hash follows a step-finish track that logged `ok=false` (175 of 187 at the second count). 60 follow `index.lock` collisions in `git add`; the rest fail in `git write-tree`, which takes the same `index.lock` and logs no warning of its own. Sessions in different processes share a store when they share a worktree, and the store lock is process-local. 114 of the 187 fell during the 2026-11-04 02:00-08:00Z host overload, when tracks took up to 822 s. Synchronous snapshots stored the same failure as `""`; both are falsy for revert and summary. 180 of the 187 are mid-turn `tool-calls` steps, which neither revert nor the summary reads.
- 24 of the 26 turns with an empty diff have a first step-start hash equal to the last step-finish hash, and their patch lists files another session changed in the shared worktree between the step-finish track and the patch op. The diff is correct; the patch over-attributes. Synchronous snapshots ran the same two ops with the same gap.
- `waitForSnapshots` is not logged. The proxy above compares tool `state.time.start` with the step-start part's `time_updated`.
- m4max logs in window A: track n 8,660, 2 not ok, p50 287 ms, p95 667 ms; 1 `index.lock`; loop to `stream` p50 206 ms. m4max logged only 14 tracks in window B, too few to compare.
- Separate from snapshots: of the user messages created on desktop and synced to m4max, 214 of 626 in 2026-11-04 12:00-18:00Z have no `summary` in m4max's DB; 195 of the same IDs have one on desktop. Turns created on m4max show the same gap in desktop's DB (123 of 298 in window A). The summary is written by a later message update, which cross-host sync does not carry.
- Processes on older binaries, 2026-11-05: none on desktop (all 13 run inode 49970241, vt-399). m4max: PID 5432, a home-screen tab with no session (`vibeterm:11`, running since 10-19), and PID 85515, the launchd `opencode serve` on 127.0.0.1:4096, started 11-02 00:13Z before vt-391.

## Current maintenance notes

- Focused tests, from `packages/opencode`: `bun test --timeout 30000 test/session/async-snapshot.test.ts test/tool/registry.test.ts test/session/snapshot-tool-race.test.ts test/session/processor-effect.test.ts`.
- A new built-in tool waits for snapshots unless it is added to the read-only list in `ToolRegistry`; only add tools that never write the worktree.
- Upstream PR body: `/home/nowaker/projekty/webapps/opencode/.vibeterm/tmp/opencode/pr-body-async-snapshots.md`; branch `async-snapshots` on `nowaker-github`. Not submitted by this session.

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- Classify the customization as preserved, conflicted, superseded, or removed.
- Reverse any deliberate uncommitted patch before merging, then reapply its canonical patch afterward.
- Regenerate derived clients or schemas instead of editing generated files.
- Run the feature's focused tests and affected package typechecks.
- Build through the host's canonical installer and verify the installed binary.
- Confirm protected services kept the same PID and start timestamp.
- Link a new timeline row to the current session record.
- Update `Last checked against upstream`.
