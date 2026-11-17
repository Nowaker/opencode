# Park a step Meridian refuses for lack of a routable Claude account

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `park-no-routable`
- First local commit: `54423dac1b`
- Current local commit(s): `54423dac1b`
- Upstream base when introduced: `006d837c50` (upstream `v1`, `v1.19.5`)
- Last checked against upstream: `006d837c50`

## Original request

Relayed by coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv) after the 2026-11-16 20:12-20:22Z incident (28 desktop sessions ended with "Provider API error (HTTP 500) - Claude Max rate limit reached"):

> 1. An error with that code or prefix, in the recorded body or the message, must not end the turn. Park it: pause the session at that step using the fork's existing pause feature (SessionPause; /pause, vibeterm_pause_turn), with the error text as the pause reason, so the TUI shows PAUSED and the reason.
> 2. On unpause, retry the SAME model step: the same request, no resubmit of the user prompt. Drop any partial output from the failed stream. Every other error behaves exactly as today. Keep it resumable across a restart of the tab if the pause feature already persists.

## Goals

- Meridian's terminal refusal (code `no_routable_account`, or message prefix `No routable Claude account: `) never ends a turn and is never retried by `SessionRetry`.
- The refused assistant message and its partial output are deleted; the session is paused with `source: {kind: "api", client: "no_routable_account"}`, `reason` = the refusal message verbatim, and `error` = the structured refusal (`code`, `message`, `incident_id`, `request_id`, `reset_at`, `profiles`, `api_error`).
- Unpause rebuilds the identical request from the unchanged history. The pause survives a process restart because it lives in `session.metadata.pause`.
- The TUI paused footer shows the reason.

## Non-goals

- No change to any other error or retry behavior, including plain `rate_limit_error` without the refusal code/prefix.
- No automatic unpause; Vibeterm's collector (part D) decides when to unpause or move sessions.
- A compaction summary refused this way still fails as before; it is not a step to run again.

## Rationale and constraints

- Inside a 200 stream, `@ai-sdk/anthropic` parses the SSE error frame with a zod schema `{type, error:{type, message}}` that strips unknown keys, so only the message reaches opencode. Hence the prefix fallback, and the incident is read from the message's trailing `(incident inc_<ms>_<seq>)` token, which Meridian added to the contract for this reason. A pre-stream HTTP 429 keeps the full body.
- A malformed Meridian field is left out rather than copied, so the stored pause stays decodable.
- `reset_at: null` is stored as an omitted field, because the SDK generator drops `null` from `NullOr`.
- `SessionProcessor.Result` was not widened: the processor answers `stop` and exposes `Handle.refusal`, so compaction's pass-through of `Result` is unchanged.
- A subagent that parks waits for unpause (as for an inherited pause), because its parent's task tool is still running it.
- If the session was already paused when the refusal arrived, the existing pause is kept as is.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `54423dac1b` | 2026-11-16 | Detect the refusal, skip retry, drop the step, pause with reason and refusal, show reason in the footer | `SessionPause.refusal`, `REFUSAL_CODE`, `REFUSAL_PREFIX`, `noticeText({parked})` in `packages/opencode/src/session/pause.ts`; `Handle.refusal` and the `Effect.retry({ while })` guard in `processor.ts`; `park` and the `"park"` outcome in `runLoop` in `prompt.ts`; `SessionPauseEvent.Refusal` and `Info.error` in `packages/schema/src/session-pause-event.ts`; `SessionPauseRefusal` in `packages/sdk/js/src/v2/gen/types.gen.ts`; paused footer in `packages/tui/src/component/prompt/index.tsx`; `test/session/pause-refusal.test.ts`, refusal cases in `test/session/pause.test.ts` |

## Verification

Session [`ses_e19b13eecffe6sjiKlzQOQXiNl`](../sessions/2026-11-16-park-no-routable-account.md):

- Red first: the two park tests failed on the unchanged source (the refusal was retried: 2 step requests instead of 1); the two unchanged-behavior tests passed there.
- `bun test test/session/pause.test.ts test/session/pause-refusal.test.ts` (packages/opencode) - 41 pass, 0 fail.
- Wider: pause, pause-refusal, prompt, processor-effect, processor-diagnostic, retry, live-events-retry, live-events-processor, compaction, message-v2, httpapi-session - 389 pass, 2 skip, 1 fail. The one failure (`unarchive records the tui actor ...`, 5s timeout) also fails on the base checkout under load.
- `bun typecheck` clean in opencode, tui, sdk/js, client; SDK and client generators re-run as a no-op.
- Real TUI on throwaway tmux socket `park-e2e` against a scripted Anthropic Messages endpoint: pre-stream 429 parked (PAUSED, reason with incident `inc_1794870000000_1`); `/unpause` sent the same request, which the endpoint refused in-stream after partial text, parked again with `inc_1794870000000_2`, partial text never shown or stored; restart of the TUI with `-s` still showed the park; `/unpause` answered "Recovered after unpause." All three turn requests carried identical `messages`. Evidence: `.vibeterm/tmp/park-e2e-evidence/` (pane captures, requests.jsonl, server.ts, run.sh).

## Timeline

- 2026-11-16 [`ses_e19b13eecffe6sjiKlzQOQXiNl`](../sessions/2026-11-16-park-no-routable-account.md) - initial build; installed on desktop as `1.19.5-vt-518-006d837c50` (m4max pending its memory gate).

## Current maintenance notes

- Contract owner: Meridian coordinator [`ses_fe8a27c6effe6KEx3TRNvOLgUo`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_fe8a27c6effe6KEx3TRNvOLgUo). Field names are fixed; changes go through it.
- If `@ai-sdk/anthropic` starts passing the full SSE error object, the body path already handles it; the prefix fallback can stay.
- Depends on [session pause](./2026-11-14-session-pause.md); a v2 port needs the same seam.
