# Pause a session after its current step and unpause it later

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `session-pause`
- First local commit: `d634b67a9be`
- Current local commit(s): `d634b67a9be`, `e60728ae6eb`, `05d3e55825c`
- Upstream base when introduced: `006d837c50` (upstream `v1`, `v1.19.5`)
- Last checked against upstream: `006d837c50` (upstream `v1`, `v1.19.5`)
- Upstream: not filed; see [pr-queue entry 09](../pr-queue/09-session-pause.md). Answers [#27511](https://github.com/anomalyco/opencode/issues/27511); the v2 shape is [#63875](https://github.com/anomalyco/opencode/issues/63875) `soft`.

## Original request

The user's ask, verbatim from the proposal `~/projects/nowaker/opencode-tools/docs/research/2026-11-14-opencode-pause-resume.md`:

> research if opencode has a feature where we could ask opencode to finish existing tool call, existing thinking + response turn, and stop right after, and then, something like /resume could just let the thing continue from where it left off, eg AI responded with text, and asked for 3 tool calls, we stop right there, and on /resume, we perform those tool calls and everything continues as normal.

The user approved "build all, as recommended", and coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv) relayed the user's decisions: `/pause`, `/unpause`, `/discard`; keybind `session_pause`; a second pause never aborts; deferred calls run before a new user message; automated input is held until unpause.

## Goals

- A pause lets the running tool finish and the current response stream to its end, then stops the loop at the step boundary. The assistant message ends cleanly, keeping the provider's `tool-calls` finish.
- Tool calls requested after the pause keep their full input as `status: "pending"` with `metadata.deferred = { reason: "paused", at }` and are not run.
- Unpause runs the deferred calls in order through the normal tool wrappers (permission asks, timeouts, plugin hooks), then continues the loop with no new user message.
- The pause and the deferred calls survive an opencode restart. Automated input is stored but starts no turn until unpause.
- Every pause, unpause and discard leaves a user-only notice naming who did it, from which machine, and when.

## Non-goals

- No `hard` pause (moving running tools to the background); that is a possible later v2 mode.
- `/resume` keeps its upstream meaning (switch session).
- A second pause does not escalate to abort; `/abort` and `session_abort` do that.

## Rationale and constraints

- The pause lives in `session.metadata.pause`, not a new column, so session sync, forks of the row and backups carry it without a migration. A fork never inherits it (`forkMetadata`).
- Status stays `idle`/`busy`/`retry` with a separate optional `paused` field, so older SDK clients and Portal keep working.
- A deferred call stays `pending` instead of using a new status, because the status enum is a public wire shape.
- The model never sees the deferral sentinel: every step rebuilds its request from stored history, and a deferred part is settled (unpause or discard) before the next model call.
- The AI SDK merges tool results from their own stream, so an instant deferral can reach the processor before its own `tool-call` event. `deferToolCall` handles both orders.
- `MessageV2` caches parts and infos by `(id, time_updated)` in milliseconds. A deferral written within the millisecond of the doom_loop check's read was served stale, so every local write now drops its row from the cache (`forgetPart`, `forgetInfo`).
- Which prompts are held is decided in one swappable place, `heldWhilePaused` in `prompt.ts`: everything without `unpause: true`.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `d634b67a9be` | 2026-11-14 | Pause state, loop gate, deferral, unpause runner, discard, held prompts, subagent wait, routes, SDK, TUI commands, keybind, footer and deferred-part rendering, docs; Send now refuses `paused` | `SessionPause` in `packages/opencode/src/session/pause.ts`; `SessionPrompt.pause`/`unpause`/`discard`, `heldWhilePaused`, `runDeferred`, the paused gate in `runLoop` and the execute wrapper in `packages/opencode/src/session/prompt.ts`; `deferToolCall` in `processor.ts`; `SessionStatus.setPaused` in `status.ts`; `forgetPart`/`forgetInfo` in `message-v2.ts`; `SessionPauseEvent` in `packages/schema/src/session-pause-event.ts`; `ToolStatePending.metadata` in `packages/schema/src/v1/session.ts`; `paused` on `SessionStatusEvent.Info`; `POST /session/:sessionID/pause`, `/unpause`, `/discard` in `httpapi/groups/session.ts`; `session_pause` keybind; `DeferredTool` in `packages/tui/src/routes/session/index.tsx` |
| `e60728ae6eb` | 2026-11-14 | Model and pin state writes log a failure instead of rejecting unhandled | `packages/tui/src/context/local.tsx` `save` |
| `05d3e55825c` | 2026-11-14 | Drop the `@ts-expect-error` that `ToolStatePending.metadata` made unused | `packages/session-ui/src/components/message-part.tsx` `partMetadata` |

The wire contract (paths, bodies, events, field names) is in the [session record](../sessions/2026-11-14-session-pause.md#contract-draft-2-fixed-2026-11-14).

## Verification

Session [`ses_e26c25ca4ffeYUicqdusaViOJa`](../sessions/2026-11-14-session-pause.md) reported:

- `bun run test test/session/pause.test.ts` (packages/opencode) - 9 pass, repeated 3 times.
- `test/session/prompt.test.ts` 106 pass, 1 skip; processor, message-v2, tools, async-snapshot, run-state, fork and compaction suites 158 pass, 1 skip; `test/server/httpapi-session.test.ts` with the new pause route test pass.
- Real TUI on a throwaway tmux socket with a scripted fake provider, against both the worktree and the installed `1.19.5-vt-486-006d837c50`: 13 of 13 checks.

## Timeline

- 2026-11-14 [`ses_e26c25ca4ffeYUicqdusaViOJa`](../sessions/2026-11-14-session-pause.md) - initial build of P1 and P2; installed on m4max as vt-486 together with the title fix.

## Current maintenance notes

- Fork-only seams an upstream bump must check: `runs` (unqueue), `drive`/`SessionRunState.ensureRunning`, `OwnerQuiescence`, the Send now refusal, and Vibeterm's metadata-block notice format.
- Regenerate the SDK with `./packages/sdk/js/script/build.ts`; never edit `packages/sdk/js/src/v2/gen`.
- The fork default `alt+p` is in `keybind-definitions.ts`; an upstream PR should default to `none`.
- Vibeterm counterparts: [pause-vt] [`ses_e26c2309cffe1Yhw092QXA2WWI`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e26c2309cffe1Yhw092QXA2WWI) in opencode-tools, [pause-portal] [`ses_e26c1d3f0ffeBskpNm6KAvzMCq`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e26c1d3f0ffeBskpNm6KAvzMCq) in Portal.
- Needs a v2 port (proposal phase P3), shaped by #63875 `soft`.
