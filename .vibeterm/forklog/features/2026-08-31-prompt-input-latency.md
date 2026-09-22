# Prompt input latency

## Identity

- Status: active
- Integration branch: `dev-nowaker` (`master-nowaker` until 2026-09-22)
- Development branch(es): `perf/prompt-editor-large-input`
- First local commit: `f4f805ce3`
- Current local commit(s): `f4f805ce3`, `800abed36`, `b895dc07c`,
  `c1edb418f`
- Upstream base when introduced: `10765ff2a` (`v1.18.25`)
- Last checked against upstream: `2406400f0` (upstream `dev`, contains `v1.18.32`)

## Original request

> revert feature of a message. when you click revert, its contents become your
> value in the prompt field, so you can modify it. however, when the prompt is
> huge, like 100 KB, (AGENTS.md used to be this big in this repo, we trimmed it
> down), the edit field became a sad experience, typing very slow. fortunately
> ^C to delete all content, and it was fast. which means the speed of edit is
> linearly related to the input length.

## Goals

- Keep prompt input responsive when the editor contains 100 KB or more.
- Bound mention-trigger work to text that can contain a valid trigger.
- Preserve display-column correctness for ASCII, CJK, emoji, combining marks,
  tabs, and newlines.
- Keep a reproducible benchmark in the source tree.

## Non-goals

- Do not modify the message-revert feature that exposes the slow editor state.
- Do not remove the remaining whole-buffer copy into the Solid prompt store.

## Rationale and constraints

- `mentionTriggerIndex` walked the complete prompt and repeatedly invoked a
  grapheme-segmentation loop, making one keypress O(n) with high constant cost.
- A mention cannot cross whitespace or a newline, so only the current
  whitespace-free run on the current editor line can contain its trigger.
- Printable ASCII and newline are each one display column; only the remaining
  text requires grapheme segmentation, with one-character overlap to preserve
  combining-cluster boundaries.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `f4f805ce3` | 2026-08-31 | Add a real prompt-input latency benchmark | `packages/tui/script/bench-prompt-input.tsx` |
| `800abed36` | 2026-08-31 | Fast-path display math and bound mention scanning | `packages/tui/src/prompt/display.ts` |
| `b895dc07c` | 2026-08-31 | Read only the current editor line for mention triggers | `packages/tui/src/component/prompt/autocomplete.tsx` |
| `c1edb418f` | 2026-08-31 | Record the investigation and measurements | `perf/prompt-input-latency.md` |

## Verification

- The introducing session measured 100 KB terminal input at 372 ms and 357 ms
  per key before the fix, versus 33 ms and 28 ms after it.
- Its isolated 100 KB `mentionTriggerIndex` measurement was 566 ms per
  keypress before the fix.
- The differential display test checks every offset in a corpus containing
  ASCII, CJK, emoji ZWJ sequences, combining marks, and tabs.
- 2026-09-02 integration gate: 7 focused TUI tests and all 32 TUI tests pass;
  `packages/tui` typecheck exits 0.

## Timeline

- 2026-08-31 `ses_fa830212effeMiM1hcYBzUbIXW` - measure and flatten prompt
  input latency on `perf/prompt-editor-large-input`, then fast-forward it into
  `master-nowaker`. Evidence: commits `f4f805ce3` through `c1edb418f` and the
  real-terminal 100 KB A/B measurements above.
- 2026-09-02
  [`ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](../sessions/2026-09-02-opencode-omo-refresh.md)
  - preserve both optimizations through the `v1.18.27` integration and rerun
  the TUI gates. Evidence: 7 focused and 32 full-suite tests pass.
- 2026-09-04
  [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-04-opencode-omo-refresh.md)
  - preserve both optimizations through `v1.18.28`. Evidence: 196 TUI tests
  pass, one skips, and `packages/tui` typecheck exits 0.

- 2026-09-08
  [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-08-opencode-dev-omo-refresh.md)
  - preserve both optimizations through upstream dev `5cd8e68fd`. Evidence:
  196 TUI tests pass, one skips, and `packages/tui` typecheck exits 0.
- 2026-09-22 [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-22-dev-nowaker-rebuild.md) -
  replayed unchanged onto upstream `dev` `2406400f0` as `dev-nowaker`; tree equals
  the `master-nowaker` + `dev` merge tree. Evidence: that session's gates.

## Current maintenance notes

- Keep `promptOffsetWidth` differential coverage when display arithmetic
  changes.
- Keep mention lookup scoped to the current line and final whitespace-free run.
- Run `bun run bench:prompt` from `packages/tui` after editor hot-path changes.
- The remaining whole-buffer store copy is intentionally outside this feature.

## Supersession or removal

- Not applicable; status is active.
