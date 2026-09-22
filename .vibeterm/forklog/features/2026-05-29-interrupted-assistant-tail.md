# Interrupted assistant tail filtering

## Identity

- Status: active
- Integration branch: `dev-nowaker` (`master-nowaker` until 2026-09-22)
- Development branch(es): `TBD - not recoverable from the surviving record`
- First local commit: `58b643c52`
- Current local commit(s): `58b643c52`
- Upstream base when introduced: `a85d8d23aa` (`v1.18.5`)
- Last checked against upstream: `2406400f0` (upstream `dev`, contains `v1.18.32`)

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

## Timeline

- 2026-05-29 `ses_18c948de5ffemtqJrtPZrtMiMf` - prevent interrupted
  assistant tails from reaching model dispatch. Inferred from the exact
  behavior terms and prefill investigation matching `58b643c52`; no exact
  commit command survived. CWD: `~/projekty/nowaker/opencode-tools`; platform:
  OpenCode; development branch not recoverable.
- 2026-08-29
  [`ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](../sessions/2026-08-29-upstream-bump-and-forklog.md)
  - preserve final-send tail filtering through `v1.18.25`. Evidence:
  `prompt.test.ts` passes inside the 388-test semantic gate.
- 2026-09-02
  [`ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](../sessions/2026-09-02-opencode-omo-refresh.md)
  - preserve final-send tail filtering through `v1.18.27`. Evidence: prompt
  dispatch coverage passes in the focused semantic gate.
- 2026-09-04
  [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-04-opencode-omo-refresh.md)
  - preserve final-send tail filtering through `v1.18.28`. Evidence: the
  3596-test package suite passes.

- 2026-09-08
  [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-08-opencode-dev-omo-refresh.md)
  - preserve final-send tail filtering through upstream dev `5cd8e68fd`.
  Evidence: 66 session prompt and system tests pass.
- 2026-09-22 [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-22-dev-nowaker-rebuild.md) -
  replayed unchanged onto upstream `dev` `2406400f0` as `dev-nowaker`; tree equals
  the `master-nowaker` + `dev` merge tree. Evidence: that session's gates.

## Current maintenance notes

- Keep the guard at the final send site, after history is selected and before
  model messages are dispatched.
- Preserve the explicit maximum-step prefill exception.

## Supersession or removal

- Not applicable; status is active.
