# Slow animation frames in an unfocused TUI

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `feat/unfocused-redraw-throttle` (opencode), `feat/unfocused-redraw-throttle` on github.com/Nowaker/opentui (OpenTUI source of the patch)
- First local commit: `af890118450`
- Current local commit(s): `af890118450`
- Upstream base when introduced: `1c41f7829be` (`dev-nowaker`, upstream `v1.19.5`)
- Last checked against upstream: `v1.19.5`

## Original request

Approved by Damian in [`qst_1cbcfd662001z8rkCfWS1hkYM8`](https://portal.vibeterm.desktop.ts.nowaker.net/question/qst_1cbcfd662001z8rkCfWS1hkYM8), Q2 "Build it":

> roll it out on desktop and m4max; existing tabs pick it up when they restart

## Goals

- A TUI whose terminal reports focus-out (tmux `focus-events on`) draws animation frames (spinner, timers) at about 1 fps.
- Content changes still render immediately while unfocused; focus-in restores the full frame rate.

## Non-goals

- No change to a focused TUI's rendering.
- No change for terminals that never report focus.

## Rationale and constraints

- On desktop, 21 TUIs in hidden tabs each wrote 50-130 KB/s of animation frames, and every write wakes the shared tmux server's loop over about 620 panes (reported by [`ses_eadf5bbb2ffe8BKh7jReU7gfet`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_eadf5bbb2ffe8BKh7jReU7gfet)).
- The renderer change lives in OpenTUI (`unfocusedFps`, `packages/core/src/renderer.ts`, OpenTUI `553e954bc` on v0.4.5) and reaches opencode through the existing Bun dependency patch, so opencode's `@opentui/core` pin stays 0.4.5.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `af890118450` | 2026-11-11 | Unfocused animation cadence of 1 fps; registered spinner timer slows to 1 s while unfocused | `patches/@opentui%2Fcore@0.4.5.patch` (`unfocusedFps`), `packages/tui/src/app.tsx`, `packages/tui/src/component/register-spinner.ts` |

## Verification

- Reported by [`ses_e32daf5bfffe61E4hf2Qd3Z9Pu`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e32daf5bfffe61E4hf2Qd3Z9Pu): `packages/tui/script/bench-unfocused.ts` on a scratch-isolated TUI in a throwaway tmux socket. Hidden spinner 1,599 -> 141 B/s; hidden continuous output 4,378 -> 142 B/s; focus-in 1,701 and 4,691 B/s; content while hidden arrives in 5.3-6.5 ms.
- `bun test` in `packages/tui` at `af890118450` on desktop - 878 pass, 0 fail (879 tests). `test/routes/session/deliver-past-ask.test.tsx` fails intermittently on `1c41f7829be` as well (3 of 6 runs), from a scratch `model.json` rename race, unrelated to this feature.

## Timeline

- 2026-11-11 [`ses_ef8235798ffejGr4sa22eXmVNv`](../sessions/2026-11-11-unfocused-redraw-throttle.md) - landed on `dev-nowaker`, built and installed on desktop and m4max. Evidence: linked session record.

## Current maintenance notes

- An `@opentui/core` bump must carry `unfocusedFps` forward: regenerate the patch from the OpenTUI branch, or drop it once upstream OpenTUI ships an equivalent option.
- OpenTUI's native library was not rebuilt (no `zig` on the authoring host); the change is TypeScript-only and runs on the published 0.4.5 native build.
