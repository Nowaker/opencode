# Stacks for logged errors and records of survived ones

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `survived-error-records`
- First local commit: `9ca01fdf5c`
- Current local commit(s): `9ca01fdf5c`
- Upstream base when introduced: `006d837c50` (merge-base with `github/v1`)
- Last checked against upstream: `006d837c50`

## Original request

> Build the item-3 proposal from your crash-report work: errors opencode survives go to GlitchTip with stack frames.
> - log error.stack on ERROR-level log lines;
> - add a process-level uncaught-exception / unhandled-rejection hook that writes a structured, bounded error record (type, message, frames, opencode version, timestamp; no env, argv, prompt or file contents) somewhere Vibeterm can read. Pick the smallest seam and keep it upstreamable if you can.

(Coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, relaying Damian's answer "Fork change + report" to `qst_1ece35a66001Wsx4RzvOyNsVMm`.)

## Goals

- An ERROR or FATAL line names where its error came from: each Error value gets a `<key>.stack` sibling, bounded to 50 frames.
- An uncaught exception or unhandled rejection the TUI worker survives leaves one JSON line in `<log dir>/errors.jsonl`: `schema`, `time`, `version`, `run`, `process`, `origin`, `type`, `message`, `stack`.

## Non-goals

- Changing whether the worker survives an error: its handlers keep swallowing.
- Shipping anything off the machine. Vibeterm's collector reads both files and reports to its GlitchTip (opencode-tools `3293703`).

## Rationale and constraints

- Upstream renders an Error on a log line as `Type: message`, and the worker's handlers were empty, so a survived error left nothing at all.
- The record holds no environment, argv or arguments. Message and each line are capped at 2000 characters, the stack at 50 frames, the writer at 30 records a minute, and a file past 1 MiB is moved to `errors.jsonl.1` first. Writing is one synchronous append and never throws.
- A failure cause already renders with its stack, so it is left alone.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `9ca01fdf5c` | 2026-11-17 | `<key>.stack` on error lines; survived-error record writer; worker handlers record | `packages/core/src/observability/logging.ts` `withStack`, `packages/core/src/observability/error-record.ts`, `packages/opencode/src/cli/tui/worker.ts` handlers |

## Verification

- `bun test test/effect/observability.test.ts test/observability/` in `packages/core` - 19 pass, 0 fail.
- `bun typecheck` in `packages/core` and `packages/opencode` - clean.
- Manual surface: the installed `1.19.5-vt-529-006d837c50` in a scratch TUI with a plugin rejecting a promise wrote one `errors.jsonl` record (`TypeError: injected survived failure`, frame in the plugin) and kept running.

## Timeline

- 2026-11-17 [`ses_e137ec059ffeNznucjtDVhy7sE`](../sessions/2026-11-17-survived-error-records.md) - initial build.

## Current maintenance notes

- On an upstream bump, check that `Logger.formatStructured` still hands Error values through unformatted to the formatter, and that `cli/tui/worker.ts` still installs its own process handlers.
