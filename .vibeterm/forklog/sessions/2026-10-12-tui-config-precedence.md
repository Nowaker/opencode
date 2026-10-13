# tui.json decides over remembered runtime toggles

## Identity

- Workday: 2026-10-12
- Session: `ses_ecd4cb9a4ffexYnAMRzHjPZDUp`
- Agent/platform: `Sisyphus - ultraworker` (`anthropic/claude-opus-5-5`) / linux
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-config-precedence`; `carry-36` (scratch, pushed
  as each owning branch's head)
- Upstream base: `dfb56f76c7` (`v1.19.0`)
- Source result commit(s): `2bee88edd6`..`24a5bd2498`
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` as item 36:

> well we need to make sure that whatever we introduce into tui conf isn't
> duplicate of existing functioinality or kind of interfering with it. screen
> all tui conf settings, check for similar gotchas in the code, and work out
> any differences with reasonable outcomes.

## Goals

- Inventory every fork tui.json key against kv toggles, palette and slash
  commands, opencode.json, env vars and Vibeterm's tui.json/kv.json writers.
- One rule for every overlap; tests per overlap; docs; both hosts installed.

## Constraints and non-goals

- No live `kv.json`/`tui.json` edits: none needed, see the feature record.
- No tab restarts; serve units untouched.
- Tips precedence and `_lib/opencode-tui-config` belong to item 34
  (`ses_ece469f46ffeIkbDfxO1jJY6D6`); generic output held under the input
  block belongs to the syntax session (`ses_ed1e2b932ffe6tTqhsOiGuYXRE`).
  Both were told the rule and agreed.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| opencode | `dev-nowaker` | `e062de2b5c` | `24a5bd2498` | ff-merge of nine commits; pushed to `origin` and `nowaker-github` |
| opencode | `tui-context-display` | `2ca56b22c1` | `a7b4222d4e` | carried fix |
| opencode | `tui-sidebar-pin-title` | `48fbfd64a6` | `af843baee3` | carried fix |
| opencode | `sidebar-session-id` | `a3fabb7014` | `ba05d50d96` | hand-ported (branch predates `layout.ts`) |
| opencode | `tui-submit-scroll` | `aeb35ccb8d` | `1c8ca3dbf7` | carried fix; test left out (needs fork `api.prompt`) |
| opencode | `tui-turn-timing` | `beb8ae93b4` | `d5287cc85e` | hand-ported |
| opencode | `tui-footer-elements` | `3bd1b72349` | `18bd0ca06f` | carried fix |
| opencode | `tui-sidebar-drag` | `66caa50b12` | `93af7f8caf` | carried fix, test in `slots.test.tsx` |
| opencode | `tui-tool-collapse` | `0dde205f4a` | `0bea99ea61` | restacked on `tui-footer-elements`, carried fix (force-with-lease) |
| opencode | `home-layout-options` | `115c96ec28` | `ef4c5a02cf` | tips toast (PR #54949) |
| opencode-tools | `master` | `7e1ce2f` | `a0aff80` | `KV_TOGGLES`, settings row text, catalog regenerated; m4max fast-forwarded |

Branch heads on `nowaker-github` carry no AI trailers (upstream rule).

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [tui.json over remembered toggles](../features/2026-10-12-tui-config-toggle-precedence.md) | new | this record |
| [Compact sidebar Context](../features/2026-10-04-sidebar-context-compact.md) | changed | `2bee88edd6` |
| [Pin the session title](../features/2026-10-04-sidebar-pin-title.md) | changed | `27d0b208a1` |
| [Session ID in the sidebar](../features/2026-10-06-sidebar-session-id.md) | changed | `e3d680468f` |
| [Keep scroll on submit](../features/2026-10-04-keep-scroll-on-submit.md) | changed | `8137a56479` |
| [Per-turn timing](../features/2026-10-04-tui-turn-timing.md) | changed | `e64c11cd60` |
| [Footer elements](../features/2026-10-07-tui-footer-elements.md) | changed | `e64c11cd60` |
| [Sidebar section order](../features/2026-10-04-sidebar-section-order.md) | changed | `267cb17a0e` |
| [Tool output collapse](../features/2026-10-08-tui-tool-output-collapse.md) | changed | `084beaa663` |
| [Home screen layout](../features/2026-10-12-home-screen-layout.md) | changed | `d6e2c3dff0` |

## Verification

- Each new test fails with only its read reverted, passes with the fix:
  `sidebar-sections.test.tsx` "sidebar.context in tui.json beats a remembered
  toggle" and "sidebar.order in tui.json beats a remembered drag";
  `keep-scroll-on-submit.test.tsx` "keep_scroll_on_submit in tui.json beats a
  remembered /keep-scroll"; on `tui-sidebar-drag`, `slots.test.tsx` "sidebar.order
  in tui.json beats a remembered drag".
- `sidebar-toggles.test.ts` (pin title, session ID, instant-screen reader) and
  `config.test.tsx` (`footerConfigured`, `footerSelections`,
  `genericToolOutputShown`) pass.
- `packages/tui`: `bun typecheck` clean; full `bun test` 658 pass, 0 fail.
- Each carried branch: `bun typecheck` clean and its touched tests pass.
- Real PTY (tmux, scratch `XDG_*`, source build): kv.json
  `{"tips_hidden":false}` with `home.tips:false` shows no tip; the same kv.json
  with `home.tips` removed shows "Tip Run /connect…"; with `home.tips:true`,
  **Hide tips** hides it, toasts "Tips hidden until opencode exits: tui.json
  sets home.tips", and kv.json stays `{"tips_hidden":false}`.
- opencode-tools: `_lib/opencode-tui-knobs`, `_lib/opencode-tui-config`,
  `settings-tui-knobs`, `settings-focus-policy` tests pass; `tsc` reports no
  error in touched files (pre-existing errors elsewhere).

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh`
- v2 migration guard gate: PASSED on desktop (2026-10-13T02:17:21Z) and m4max
  (2026-10-13T02:18:58Z).
- Installed artifact: desktop `1.19.0-vt-271-dfb56f76c7` (inode `49959251`),
  m4max `1.19.0-vt-271-dfb56f76c7` (inode `31463946`); both carry the retry
  marker.
- Running services: `opencode-serve-tailscale` (PID 5053) and
  `opencode-serve-lan` (PID 18623) not restarted; no tabs restarted.

## Commit provenance

- `2bee88edd6`..`24a5bd2498` - source on `dev-nowaker`.
- Required trailer: `AI-Session-ID: ses_ecd4cb9a4ffexYnAMRzHjPZDUp`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-12-tui-config-precedence.md
```

## Unknowns and blocked verification

- `tui-submit-scroll` and `tui-turn-timing` have no rendering test on their own
  branches; their fixes are tested on `dev-nowaker`.
