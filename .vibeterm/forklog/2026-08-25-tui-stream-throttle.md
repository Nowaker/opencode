# TUI streaming render throttle

## Identity

- Status: active
- Integration branch: `master-nowaker`
- Development branch(es): direct commit on `master-nowaker`
- First local commit: `4a2673957`
- Current local commit(s): `4a2673957`
- Upstream base when introduced: `4643e65ad6` (`v1.18.18`)
- Last checked against upstream: `10765ff2a` (`v1.18.25`)

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

## Session ledger

- 2026-08-25 `333bd0f1-6d75-4c64-b8e2-003f45ce2379` - coalesce streaming
  deltas and throttle renders. Confirmed by the Claude transcript's exact
  `4a2673957` checkout, its session timestamp, and its implementation worktree
  `/home/nowaker/projekty/nowaker/opencode-tools-qpane-ux`; the original prompt
  remains unavailable.

## Current maintenance notes

- Preserve same-part coalescing and lifecycle-event immediacy when upstream
  changes event envelopes.
- Keep the context SDK tests in the semantic bump gate.

## Supersession or removal

- Not applicable; status is active.
