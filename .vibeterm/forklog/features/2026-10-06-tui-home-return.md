# Return to the scrolled-up position on messages_first

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-home-return` (stacked on `tui-block-nav` `fdba5ac828`; also the upstream PR head)
- First local commit: `bed5ec8209` (cherry-pick of `78ce706b7d` on `tui-home-return`)
- Current local commit(s): `bed5ec8209`
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `907b3bc518` (upstream `dev`)
- Upstream: issue [#53629](https://github.com/anomalyco/opencode/issues/53629), PR [#53630](https://github.com/anomalyco/opencode/pull/53630) (stacked on #53333)

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, quoting the user:

> also new feature for ctrl+home/end bindings. when you scroll up, wherever
> you are at, it gets remembered by opencode, then you ctrl+end to be back
> down; then you click ctrl+home and it's bringing you back where you were at
> before scrolling to the end. only subsequent ctrl+home press gets you to the
> very top.

## Goals

- `messages_last` (`end`, `ctrl+end`) from a scrolled-up view remembers it.
- The next `messages_first` (`home`, `ctrl+home`) returns there; a second one
  goes to the top.

## Non-goals

- None recorded.

## Rationale and constraints

- The mark is the renderable at the top of the viewport plus its offset from
  that edge, not a scroll offset (drifts as content changes) or a part id
  (`apply_patch` repeats its part id across one box per file).
- The mark is dropped, and `messages_first` goes to the top, when it was taken
  in another session; when the view is no longer at the bottom; when any other
  navigation command ran in between (page, half page, line, prompt, landmark,
  block, last user message) or the wheel scrolled the transcript
  (`onMouseScroll`); or when its renderable is destroyed or no longer a child
  of the scrollbox content.
- `messages_last` at the bottom keeps the mark it holds, so new output or a
  submitted prompt in between does not lose it.
- Restoring only runs from the bottom, where the view follows output, so it
  does not interact with sticky scroll; `keepScrollAnchor` handles later
  layout changes like any scroll-up. `keep_scroll_on_submit` does not move the
  view, so a submit at the bottom leaves the mark usable.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `bed5ec8209` | 2026-10-06 | remember on `messages_last`, return on `messages_first` | `rememberScroll` / `recallScroll` / `ScrollReturn` in `packages/tui/src/routes/session/navigation.ts`; `scrollReturn`, `viewAtBottom`, `viewTop` and the `session.first` / `session.last` commands plus `onMouseScroll` on the transcript scrollbox in `packages/tui/src/routes/session/index.tsx`; `messages_first` description in `packages/tui/src/config/keybind.ts` |

## Verification

- `bun typecheck` and `bun test` in `packages/tui` on `dev-nowaker`:
  255 pass, 0 fail. `test/routes/session/navigation.test.ts` covers the
  remember/recall rules.
- Manual surface: isolated `XDG_*`, throwaway tmux socket `oc-tui-nav`, the
  hosts' keybind overrides in a scratch `tui.json`. Scrolled up, `C-End`,
  `C-Home` returns, `C-Home` again reaches the top; `C-End` then `C-Up`, or
  `C-End` then line up and back down, drops the mark; `C-End` twice keeps
  it; a view three rows into a response restores all 30 captured viewport
  rows byte for byte. Repeated on the installed `1.18.34-vt-118` build.

## Timeline

- 2026-10-06
  [`ses_ef46f1775ffe29MtElYF4DQySL`](../sessions/2026-10-06-tui-nav-layout.md)
  - `bed5ec8209`: introduce; upstream issue #53629 and stacked PR #53630;
    build and install on desktop and m4max.
- 2026-10-09
  [`ses_ef46f1775ffe29MtElYF4DQySL`](../sessions/2026-10-09-editor-home-end.md)
  - `680e8a0daa`: the fork's editor-standard defaults move `messages_first` /
    `messages_last` to `ctrl+alt+home` / `ctrl+alt+end`; the return-to-mark
    follows the command.

## Current maintenance notes

- Drop the fork commit once PR #53630 (or an equivalent) is in upstream `dev`.
- No host setting needed.

### Upstream integration checklist

- Confirm `session.first` / `session.last` still go through `recallScroll` /
  `rememberScroll`, and every other scroll command clears `scrollReturn`.
- Run `test/routes/session/navigation.test.ts` and `bun typecheck` in
  `packages/tui`.
- Build through `.vibeterm/build.sh`; scroll up, `ctrl+end`, `ctrl+home`
  twice.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
