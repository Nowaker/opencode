# Apply a pending revert without starting a turn

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch: `apply-revert`
- First local commit: `c813788a7fcf4b91d8a8f1cab9eb5191ab183f9f`
- Current local commits: `c813788a7f`, `9936a766c7`
- Upstream base when introduced: `006d837c50` (`v1.19.5`)
- Last checked against upstream: `006d837c50`, the contained base; no new upstream equivalence audit or PR was requested.

## Original request

Assigned by parent `ses_e6531c061ffegBt3ZBgRiiwNCQ`:

> Implement terminal/Vibeterm half of prompt-free pending message revert.

> Reuse engine cleanup without invoking SessionPrompt or admitting any input. Preserve file revert selection semantics and avoid accidental prompt draft submission; retain draft for later.

## Goals

- Apply the pending cut from the native revert card or command palette without typing a replacement prompt or starting a model turn.
- Physically remove the selected message or part suffix, clear the marker, retain the draft and current file state, and support busy refusal and error retry.

## Non-goals

- No new native before/after message menus, slash command or default keybind. The named before/after selection pair belongs to Portal's separate UI.
- No automatic abort, live tab restart, upstream PR or changes to another owner's dirty retry patch.

## Rationale and constraints

- Existing cleanup ran when a later prompt was admitted. Deleting individual messages was not equivalent: it did not clear the marker and could leave a partial cut.
- The client waits for an optimistic revert request before applying and lets removal/update events change the transcript after success.
- A disabled Enter must be dropped before the composer's IME deferral. Checking only after the deferred work lets an Enter pressed during Apply submit once Apply re-enables the composer.
- Final native installs use clean managed worktrees. Deliberate uncommitted retry changes remain in each primary checkout and are excluded from these clean-source artifacts.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `c813788a7f` | 2026-11-01 | Idle-guarded, idempotent pending cleanup and regenerated legacy SDK | `SessionRevert.apply`/`cleanup`; `POST /session/:sessionID/revert/apply`; `session.applyRevert`; `test/server/httpapi-session.test.ts` |
| `9936a766c7` | 2026-11-01 | Apply/Retry card action, palette command, retained draft, disabled Enter boundary and deterministic renderer regressions | `applyRevertSession`; `session.revert.apply`; `Prompt` textarea `onSubmit`; `test/routes/session/apply-revert.test.tsx` and `test/fixture/apply-revert.ts`; `tui.mdx` |

## Verification

- Backend: `bun run test test/server/httpapi-session.test.ts test/session/revert-compact.test.ts` from `packages/opencode` - 39 pass, 0 fail, 204 assertions. Exact before/after and part cuts, marker clearing, repeat, busy refusal/retry, current files, zero input admission and zero model calls.
- TUI: `bun run test test/routes/session` from `packages/tui` - 67 pass, 0 fail, 240 assertions, including seven real-renderer/real-helper scenarios with native message selection, palette and mouse actions, draft hashes, disabled Enter, sync, retry and 40/80-column dark/light layouts.
- Prompt regression command in the linked session - 68 pass, 0 fail, 267 assertions. OpenCode, TUI and Client package typechecks pass; all 30 workspace pre-push typecheck tasks pass.
- Legacy SDK generation reproduces its output on the second run; Client generation is a no-op. Cleanup and idle-guard mutations make the owner tests fail and are restored.
- Both installed native binaries pass loopback HTTP cleanup probes: three seeded no-reply messages become exactly one; marker clears; repeat is unchanged; no turn starts; owned server is reaped and fixture removed.
- The broad public OpenAPI busy-error assertion fails identically on the unchanged base and remains outside this change.

## Timeline

- 2026-11-01 [`ses_e652b2871ffe8ePJ17VkrGTnma`](../sessions/2026-11-01-apply-revert.md) - built and verified the native action and guarded endpoint, integrated both source commits, published both mirrors, then independently built and installed `1.19.5-vt-394-006d837c50` from clean managed source on desktop and m4max.

## Current maintenance notes

- Preserve cleanup as a no-input/no-run operation, file-choice semantics, and the immediate disabled guard before native textarea submit deferral.
- Regenerate `packages/sdk/js/src/v2/gen` through `./packages/sdk/js/script/build.ts`; run Client generation when its authoritative API changes rather than editing generated files.
- Build with explicit `OPENCODE_SRC` pointing to a clean managed worktree, no fake version override, and the mandatory v1 migration guard. Existing processes retain their loaded inode until an owner-controlled restart.
