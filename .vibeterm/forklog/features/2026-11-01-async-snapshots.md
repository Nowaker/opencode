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
