# Choose the running-turn animation: scanner or one-cell spinner

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `busy-indicator` (worktree off `dev-nowaker`)
- First local commit: `5b6ed238d3`
- Current local commit(s): `5b6ed238d3`
- Upstream base when introduced: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Last checked against upstream: `dfb56f76c7`
- Upstream: none. Fork-only by the coordinator's instruction (not a critical v1 fix).

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, the user verbatim:

> new tui featre: in progress animation, replacable. current one is like Knight Industries Two Thousand hehe, sliding left/right. the issue with it is that on very lagged servers, you don't get to see if it's doing anything now because many 'frames' of this are noop. option to replace with the single character block animation, like we have for submitting prompt. default for vibeterm: that new one.

## Goals

- `busy_indicator` in tui.json: `"scanner"` (default, upstream's sliding bar, unchanged) or `"spinner"`, the one-cell braille spinner the other busy notices (Sending prompt, Thinking, running tools) use.
- Applies wherever the scanner was drawn: the session prompt footer left of `esc interrupt`, and the `opencode run` footer.

## Non-goals

- Changing the one-cell `Spinner` component or any row that already used it (subagent rows, tool rows, Thinking, dialogs).
- An upstream PR.

## Rationale and constraints

- The scanner holds still for 39 of its 54 frames (30 + 9 hold frames), so on a host too lagged to draw every 40 ms frame a running turn can look frozen. Every spinner frame is a different glyph.
- One definition, `busyIndicator()` in `packages/tui/src/ui/spinner.ts`, builds both styles for both footers; the spinner reuses `TuiLayout.Spinner`'s frames and interval, not a copy.
- Vibeterm sets `spinner` as its default through opencode-tools `d4b5a6beb13` (enforced while the user has no value in Vibeterm settings, like `prompt.history_scope`).

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `5b6ed238d3` | 2026-10-18 | `busy_indicator`; shared `busyIndicator()`; both footers use it; docs | `BusyIndicator` and `Info.busy_indicator` in `packages/tui/src/config/index.tsx`; `busyIndicator` in `packages/tui/src/ui/spinner.ts`; `spinnerDef` in `component/prompt/index.tsx`; `spin` in `packages/opencode/src/cli/cmd/run/footer.view.tsx`; `RunTuiConfig` in `run/types.ts` and `runTuiConfig` in `run/runtime.boot.ts`; `busy_indicator` in `tui.mdx` Options |

## Verification

Reported by `ses_eaca65b1bffeZBbc3UZRmHnrMn`; see its [session record](../sessions/2026-10-18-busy-indicator.md).

## Timeline

- 2026-10-18 [`ses_eaca65b1bffeZBbc3UZRmHnrMn`](../sessions/2026-10-18-busy-indicator.md) - initial build, vt-364 on both hosts, Vibeterm default `spinner` enforced on both. Evidence: `5b6ed238d3`; real-TUI frame captures of both styles.

## Current maintenance notes

- On an upstream bump, check that the scanner options in `busyIndicator()` still match what upstream passes to `createFrames`/`createColors` in the prompt footer and `opencode run` footer.
- `packages/tui/test/component/prompt-footer.test.tsx`'s first test times out at bun's default 5 s on a cold boot, also before this change; run the file with `--timeout 30000`.
