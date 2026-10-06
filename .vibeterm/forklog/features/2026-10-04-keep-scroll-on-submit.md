# Keep the scroll position when a prompt is submitted

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-submit-scroll` (off upstream `dev` `907b3bc518`; also the upstream PR head)
- First local commit: `defa72ee22`
- Current local commit(s): `defa72ee22`
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `907b3bc518` (upstream `dev`)
- Upstream: issue [#53186](https://github.com/anomalyco/opencode/issues/53186), PR [#53187](https://github.com/anomalyco/opencode/pull/53187)

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, quoting the user:

> submitting a prompt scrolls me immediately back down. in vibeterm, system
> prompts arrive in tuis so this is disruptive. this should be a tui setting,
> default off, here and m4max: on, and modifiable in runtime like other things
> like /timestamps.

## Goals

- With the setting on, submitting a prompt (typed, or typed into the composer
  by Vibeterm) leaves a scrolled-up session viewport where it is.
- `tui.json` option, default off (upstream behavior), plus a persisted runtime
  toggle.

## Non-goals

- Streaming AI output pulling a scrolled-up viewport down is a separate fix
  (item 1 of the coordinator's effort), not this feature.

## Rationale and constraints

- Upstream calls `toBottom()` unconditionally from the session prompt's
  `onSubmit` and from the `session_prompt` slot's `on_submit`.
- The value is read with `kv.get(key, tuiConfig.keep_scroll_on_submit ?? false)`
  rather than `kv.signal`: `kv.signal` writes its default into the store, the
  next unrelated `kv.set` persists it, and later `tui.json` edits would be
  shadowed.
- A viewport at the bottom keeps following output through the scrollbox's
  existing `stickyScroll`, so on and off differ only when scrolled up.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `defa72ee22` | 2026-10-04 | `keep_scroll_on_submit` option, `/keep-scroll` toggle, submit skips `toBottom()` when on | `keep_scroll_on_submit` in `TuiConfig.Info` (`packages/tui/src/config/index.tsx`); `keepScrollOnSubmit` / `onPromptSubmit` and command `session.toggle.keep_scroll_on_submit` in `packages/tui/src/routes/session/index.tsx`; `tui.mdx` option list |

## Verification

- `bun test test/config.test.tsx` (9 pass) and `bun typecheck` in
  `packages/tui`, on the upstream branch and on `dev-nowaker`.
- Manual surface (isolated XDG dirs, throwaway tmux, local fake streaming
  LLM): vanilla `dev` and the default both jump to the new prompt after a
  scrolled-up submit; with `/keep-scroll` on the top line stays
  `reply line 44` before, 1 s after and after the reply finished; at the
  bottom the reply is still followed; `"keep_scroll_on_submit": true` in
  `tui.json` works with no kv override and `kv.json` does not get the key.

## Timeline

- 2026-10-06 [`ses_eeda1d251ffel81U5Y42j4kb33`](../sessions/fork-audit.md) -
  add real app/composer-submit default/config/toggle proofs and inverse red
  probes; isolated real TUI outcomes are in the linked inventory.

- 2026-10-04
  [`ses_ef81c7229ffeqHzmyR9O4v0AMH`](../sessions/2026-10-04-keep-scroll-on-submit.md)
  - `defa72ee22`: introduce; upstream issue #53186 and PR #53187; build and
    install on desktop and m4max; enable in `tui.json` on both hosts.

## Current maintenance notes

- Drop the fork commit once PR #53187 (or an equivalent) is in upstream `dev`.
- Hosts set `"keep_scroll_on_submit": true` in `~/.config/opencode/tui.json`;
  a `keep_scroll_on_submit` key in the TUI `kv.json` (set by `/keep-scroll`)
  overrides it.

### Upstream integration checklist

- Locate both submit call sites (`Prompt` `onSubmit`, `session_prompt` slot
  `on_submit`) and confirm each still goes through `onPromptSubmit`.
- Run `test/config.test.tsx` and `bun typecheck` in `packages/tui`.
- Build through `.vibeterm/build.sh`; scroll up and submit in a TUI.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
