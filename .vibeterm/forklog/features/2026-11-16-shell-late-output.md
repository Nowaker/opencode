# Keep a fast command's output for readers that attach late

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `shell-output-race`; upstream head `keep-late-output`
- First local commit: `1a4cba2fbef`
- Current local commit(s): `1a4cba2fbef`
- Upstream base when introduced: `006d837c50` (`v1.19.5`)
- Last checked against upstream: `6a5339d0661` (`v1`, 2026-11-16)

## Original request

> BUG: the bash/shell tool can silently drop a fast command's stdout. The model and the UI get "(no output)" for a command that printed and exited 0.

> Fix at the cause: attach the output reader, or buffer the streams, before the child is resumed, so no byte can be emitted before someone is listening. Keep streaming behavior for long commands unchanged (incremental preview updates still arrive). Check every other caller of CrossSpawnSpawner for the same lazy-subscription hazard and fix it there too, or say why it is safe.

Coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv), 2026-11-16. The bug was found by [`ses_e1c952bf0ffe83nzH8FOR8uzzX`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e1c952bf0ffe83nzH8FOR8uzzX)'s streaming work.

## Goals

- A command that prints and exits immediately returns its full output, including the running-part `metadata.output` update, however late the reader attaches.
- Long commands keep streaming incremental preview updates.

## Non-goals

- No change to the shell tool's truncation, background or timeout behavior.

## Rationale and constraints

- Node and Bun discard what a child wrote to a stdio pipe with no data listener once the child exits. `CrossSpawnSpawner` handed out lazy `NodeStream.fromReadable` streams over the bare pipes, so nothing listened until the caller's reader fiber started. `ShellTool` forks that reader only after `spawn()` returns.
- The fix sits in the spawner, so it covers every caller: the shell tool, the `!` prompt shell, `AppProcess.run`/`runStream`, ripgrep, project and git probes, and the platform `string`/`lines` helpers. No caller needs its own change.
- Backpressure is kept: while the child runs, a full buffer pauses its pipe. After the exit the remainder is buffered without limit, because the exit is reported on `close`, which waits for every pipe to end.
- Upstream fixed the same race on `v2` in [#46463](https://github.com/anomalyco/opencode/pull/46463) (`a6b49b3f740`, `packages/util/src/cross-spawn-spawner.ts`); it was never backported to `v1`.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `1a4cba2fbef` | 2026-11-16 | Drain every output pipe into a `PassThrough` synchronously after launch; `setupOutput`/`setupFds` read the buffers | `spawn()` and `Outputs` in `packages/core/src/cross-spawn-spawner.ts`; tests "output read after the process exits" and "keeps a fast command's output when the child exits before the reader attaches" |

The fork's `ShellTool` already joins its reader after the exit (`Fiber.join(reader)` from `5cc30c46fbc`, bash background). Upstream `v1` lacks that join, so the upstream head `keep-late-output` adds it too.

## Verification

- `packages/core`: `bun test test/effect/cross-spawn-spawner.test.ts` - 27 pass; before the fix the late-reader case read `""` for stdout and stderr. Full core suite 1218 pass, 0 fail with a system `TMPDIR`.
- `packages/opencode`: the ShellTool case fails before the fix with `(no output)` and passes after; shell, shell-background, grep, glob, timeout, project, snapshot, git, mcp, format, prompt and installation suites: 496 pass, 0 fail with a system `TMPDIR`.
- `bun typecheck` passes in `packages/core` and `packages/opencode`.
- Manual surface: an installed vt-511 `opencode run` session on m4max made four bash calls (`echo`, `printf`, an `echo` to stderr). Every tool part in `opencode.db` carries the output in both `state.output` and `state.metadata.output`, with exit 0. The same check on desktop vt-512 passed for all seven bash calls the model made.

## Timeline

- 2026-11-16 [`ses_e1bb77423ffeFABSFtCGeavd1T`](../sessions/2026-11-16-shell-late-output.md) - initial fix, m4max vt-511, desktop vt-512, upstream head `keep-late-output`, pr-queue entry `10-shell-late-output.md`.

## Current maintenance notes

- If upstream merges the `v1` backport ([pr-queue 10](../pr-queue/10-shell-late-output.md)) or the fork moves to the v2 spawner from #46463, an upstream bump supersedes this change. Keep the fork's side when a merge conflicts in `spawn()`.

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
