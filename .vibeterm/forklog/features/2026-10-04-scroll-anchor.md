# Keep a scrolled-up reader's place in a long session

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `fix-scroll-follow` (off upstream `dev` `907b3bc518`; also the upstream PR head)
- First local commit: `6ff168d896`
- Current local commit(s): `6ff168d896`
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `907b3bc518` (upstream `dev`)
- Upstream: existing issue [#41243](https://github.com/anomalyco/opencode/issues/41243)
  (root cause of #29094 / #4196), PR [#53219](https://github.com/anomalyco/opencode/pull/53219)

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, quoting the user:

> when i scroll up in chat log, and stay there, so i can read, ai activity
> constantly interrupts me, and scrolls the content down as it generates
> responses. this is a clear bug, needs a fix.

## Goals

- While scrolled up, new and streaming AI output does not move the viewport.
- At the bottom, the transcript keeps following the stream; `End` and
  scrolling back down resume following.

## Non-goals

- Scrolling on prompt submit is
  [Keep the scroll position when a prompt is submitted](./2026-10-04-keep-scroll-on-submit.md).
- No setting: this is a bug fix.

## Rationale and constraints

- Sticky scroll is not the cause. In sessions under 100 messages, wheel,
  PageUp and line-up already hold on vanilla `dev`, both while streaming and
  through tool calls.
- The cause is `context/sync.tsx`, which keeps at most 100 messages per
  session and `shift()`s the oldest on every new one. Each drop removes rows
  above the viewport under a fixed `scrollTop`, so the text slides up until it
  reaches the bottom, where sticky scroll re-engages.
- The fix measures the layout change instead of predicting the pruned height
  (the approach of upstream PR #41247, auto-closed without review). It needs no
  `id` on assistant message boxes, and it covers any height change above the
  viewport.
- The root renderable emits `layout-changed` after computing the layout and
  before any renderable reads it. `ScrollBox` content's own `resize` fires too
  late in the frame: the test showed the drift with that hook.
- The TUI streaming render throttle does not interact: it only lowers how often
  frames, and so this check, run.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `6ff168d896` | 2026-10-04 | Re-anchor the first visible transcript child after every layout while not at the bottom | `keepScrollAnchor()` in `packages/tui/src/util/scroll.ts`; its call in the session `<scrollbox ref>` in `packages/tui/src/routes/session/index.tsx`; `packages/tui/test/util/scroll.test.tsx` |

## Verification

- `bun test test/util/scroll.test.tsx` in `packages/tui`: 2 pass. With the
  hook disabled, the anchor test fails (`item 25` expected, `item 28`
  received).
- `bun test` in `packages/tui` on `dev-nowaker` + the fix: 219 pass, 1 skip,
  0 fail; `bun typecheck` passes.
- Manual surface (isolated XDG dirs, tmux socket `oc-tui-scroll`, local fake
  OpenAI-compatible server streaming markdown, reasoning and a bash tool call
  per step, session past 100 messages): on vanilla `dev` the scrolled-up view
  slid from `Step 96` to `Step 101` in 20 s. With the fix it stayed at
  `Step 586 closing` / `Step 587 bullet two` for 40 s, and `End` resumed
  following at `Step 596`.

## Timeline

- 2026-10-04
  [`ses_ef81ca107ffet5DwnFLaGWlUap`](../sessions/2026-10-04-scroll-anchor.md)
  - `6ff168d896`: introduce; upstream PR #53219 closing #41243; build and
  install on desktop and m4max.

## Current maintenance notes

- Drop the fork commit once PR #53219 (or an equivalent fix for #41243) is in
  upstream `dev`.
- If upstream removes or changes the 100-message prune in `context/sync.tsx`,
  keep the anchor anyway: it covers any height change above the viewport.

### Upstream integration checklist

- The session transcript `<scrollbox>` ref still calls
  `keepScrollAnchor(renderer, r)`.
- `@opentui/core` still emits `layout-changed` from `RootRenderable` after
  `calculateLayout()` and before `updateLayout()`. Run
  `test/util/scroll.test.tsx` after every opentui bump.
