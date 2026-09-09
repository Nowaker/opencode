# TUI streaming render throttle

## Identity

- Status: active
- Integration branch: `master-nowaker`
- Development branch(es): direct commit on `master-nowaker`
- First local commit: `4a2673957`
- Current local commit(s): `4a2673957`
- Upstream base when introduced: `4643e65ad6` (`v1.18.18`)
- Last checked against upstream: `5cd8e68fd` (upstream `dev`, post-`v1.18.29`)

## Original request

The initial human prompt is not recoverable verbatim from the safe visible
record. The surviving continuation prompt is:

> Continue from where you left off.

## Goals

- Coalesce adjacent streaming deltas for the same message part.
- Limit event-driven TUI rendering to ten frames per second.
- Keep prompt input responsive in large retained sessions.

## Non-goals

- Do not drop persisted events or delay non-stream lifecycle updates.

## Rationale and constraints

- Rebuilding the retained OpenTUI tree up to 60 times per second drives garbage
  collection and can starve prompt input.
- The throttle belongs in the TUI SDK event path, not in server persistence or
  transport, so other clients retain full event fidelity.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `4a2673957` | 2026-08-25 | Coalesce deltas and cap renders at 10 FPS | `packages/tui/src/context/sdk.tsx` event pipeline |

The Claude session began at 2026-08-25 14:58:43 America/Chicago, so the
evening-to-early-morning convention does not move this work to August 24.

## Verification

- 2026-08-29 targeted TUI gate: 5 pass / 0 fail across SDK context and event
  tests.
- `packages/tui` typecheck exits 0.

## Timeline

- 2026-08-25 `333bd0f1-6d75-4c64-b8e2-003f45ce2379` - coalesce streaming
  deltas and throttle renders. Confirmed by the Claude transcript's exact
  `4a2673957` checkout, its session timestamp, and its implementation worktree
  `/home/nowaker/projekty/nowaker/opencode-tools-qpane-ux`; the original prompt
  remains unavailable.
- 2026-08-29
  [`ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](../sessions/2026-08-29-upstream-bump-and-forklog.md)
  - preserve same-part coalescing and the 10 FPS cap through `v1.18.25`.
  Evidence: 5 targeted TUI tests pass and `packages/tui` typecheck exits 0.
- 2026-09-02
  [`ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](../sessions/2026-09-02-opencode-omo-refresh.md)
  - preserve same-part coalescing and the 10 FPS cap through `v1.18.27`.
  Evidence: 7 focused and 32 full-suite TUI tests pass, plus typecheck.
- 2026-09-04
  [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-04-opencode-omo-refresh.md)
  - preserve same-part coalescing and the 10 FPS cap through `v1.18.28`.
  Evidence: 196 TUI tests pass, one skips, and typecheck exits 0.

- 2026-09-08
  [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-08-opencode-dev-omo-refresh.md)
  - preserve same-part coalescing and the 10 FPS cap through upstream dev
  `5cd8e68fd`. Evidence: 196 TUI tests pass, one skips, and typecheck exits 0.

## Current maintenance notes

- Preserve same-part coalescing and lifecycle-event immediacy when upstream
  changes event envelopes.
- Keep the context SDK tests in the semantic bump gate.

## Supersession or removal

- Not applicable; status is active.
