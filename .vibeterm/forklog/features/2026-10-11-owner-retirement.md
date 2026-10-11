# Cooperative owner retirement

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch: `owner-quiescence`
- First local commit: `bd2840ad04`
- Current source commits: `bd2840ad04`, `6deb4c2570`
- Upstream base and last checked: `dfb56f76c7637d5d34167bba405fe23f916f37e9`

## Original request

> restart when no active turns except yours, and after idlepark feature being implemeenetd on desktop introduces idle parkign without status loss for red trinagle status sessions. (ask to be notified)

## Goals and constraints

- Let Vibeterm prove an engine idle before retirement without interrupting work.
- Preserve accepted native composer text, parts and caret before process exit.
- Keep committed engine admission and composer input closed during disposal.
- No model/provider changes, shared-server consolidation or forced active cuts.

## Stable seams

| Commit | Behavior | Seam |
|---|---|---|
| `bd2840ad04` | Process-wide admission through preparation, native promises, detached work and cleanup; irreversible owner commitment | `packages/opencode/src/owner/quiescence.ts`, plugin `ownerQuiescence`, `/global/quiescence` |
| `6deb4c2570` | Native composer seal, visible rejection of new input, exact-original-seal cooperative exit | `packages/plugin/src/tui-prompt.ts`, `api.lifecycle.retire`, `packages/tui/src/context/composer-seal.tsx` |

The engine seal counts reservations, not unique sessions. Promise admissions
remain owned until underlying settlement even after fiber interruption. A
temporary seal defers plugin events; release starts them with reserved admission.
Commitment discards deferred starts and cannot be undone by release or disposal.
Explicit shutdown cleanup remains available without reopening ordinary work.

The composer refuses busy work and open dialogs. While sealed, input is visibly
paused; new keys and pastes are rejected rather than buffered. Its captured draft
is detached from mutable state. Retirement requires the original seal object,
commits it synchronously, and initiates the existing renderer/worker exit chain.
An accepted retirement response is not proof of OS process death.

## Verification

- Parent focused engine/HTTP/LSP/instance/plugin/shutdown run: 10 tests passed.
- Parent composer-seal/component run: 15 tests passed, 67 assertions.
- OpenCode, TUI, plugin, core and SDK package typechecks passed.
- Both required SDK/client generators ran; broad pre-push typecheck passed all
  30 tasks after normal dependency installation repaired missing package links.
- Real source ordinary and warm TUI retirement/recovery passed. The tooling's
  full live-owner scheduler passed 20 assertions, including exact successor
  draft consumption and no submitted model turn.
- The outside-instance LSP test failure reproduced on untouched `fef2eadc85`
  under the same project-scoped scratch topology; it is not an introduced fix.

## Timeline

- 2026-10-11 [`ses_ee0ceb1aaffeh6u0RxoARcBsk1`](../sessions/2026-10-11-owner-retirement.md):
  source implementation, independent safety review, isolated acceptance and
  fast-forward integration; host install evidence is in the session record.

## Maintenance

- Preserve both promise settlement and detached-fiber reservation boundaries.
- Regenerate SDK v2 from the server API instead of hand-editing generated files.
- Recheck exact seal identity, async composer completion and disposal on TUI bumps.
- Vibeterm's durable authorization, producer fence and server replacement live
  in the separate `opencode-tools` repository, not in this primitive.
