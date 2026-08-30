# Interrupted assistant tail filtering

## Identity

- Status: active
- Integration branch: `master-nowaker`
- Development branch(es): `TBD - not recoverable from the surviving record`
- First local commit: `58b643c52`
- Current local commit(s): `58b643c52`
- Upstream base when introduced: `a85d8d23aa` (`v1.18.5`)
- Last checked against upstream: `10765ff2a` (`v1.18.25`)

## Original request

TBD - no surviving original prompt found. Transcript evidence preserves the
`interrupted trailing assistant` and assistant-prefill investigation.

## Goals

- Prevent a retried model request from ending in an interrupted assistant
  message when no new user turn was persisted between attempts.
- Preserve intentional assistant prefill used by the maximum-step path.

## Non-goals

- Do not change the pure message-conversion utility or delete persisted history.

## Rationale and constraints

- Claude Opus 4.x and GPT-5.x Codex reject assistant-prefill requests unless
  that prefill is intentional and supported.
- Filtering belongs immediately before model dispatch so other history readers
  continue to see the complete persisted transcript.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `58b643c52` | 2026-05-29 | Drop an interrupted trailing assistant from dispatched history | prompt-loop model send site |

## Verification

- The introducing test seeds user -> aborted assistant history and captures the
  model request, proving it no longer ends on the assistant row.
- 2026-08-29 semantic gate: `prompt.test.ts` passes inside
  388 pass / 3 skip / 0 fail.

## Session ledger

- 2026-05-29 `ses_18c948de5ffemtqJrtPZrtMiMf` - prevent interrupted
  assistant tails from reaching model dispatch. Inferred from the exact
  behavior terms and prefill investigation matching `58b643c52`; no exact
  commit command survived. CWD: `~/projekty/nowaker/opencode-tools`; platform:
  OpenCode; development branch not recoverable.

## Current maintenance notes

- Keep the guard at the final send site, after history is selected and before
  model messages are dispatched.
- Preserve the explicit maximum-step prefill exception.

## Supersession or removal

- Not applicable; status is active.
