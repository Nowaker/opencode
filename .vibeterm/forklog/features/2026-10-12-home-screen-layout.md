# Prompt start height, percentage sizes and home screen layout

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `home-layout` (off `dev-nowaker`); upstream
  `prompt-fit-screen` (PR #54948) and `home-layout-options` (PR #54949,
  stacked on #54948), both off `github/v1`
- First local commit: `7a377b7324`
- Current local commit(s): `7a377b7324`, `f77943745f`
- Upstream base when introduced: `dfb56f76c7` (`v1.19.0`)
- Last checked against upstream: `dfb56f76c7` (`v1.19.0`)

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` as item 34:

> tui config allow to set max w/h of prompt, but doesn't let us set starting
> height. prompt grows from starting height to maximum heights before
> scrolling happens. width/height and width should allow % setting of
> available space (accounted for all other elements guaranteed space) to fill.
> eg 80%.
> i also noticed that new session prompt screen, when you keep adding \n it
> will grow past the viewport, lol. it has no limits. unsure if it's our bug,
> or not, but it needs fixing either way.
> also, opencode logo itself seems to have a minimum margin-top of ~5 lines
> (when prompt is the largest), that's excessive, makke it 1.
> tui option to show/disable:
> - ● Tip Use pgup , ctrl+alt+b/pgdn , ctrl+alt+f to navigate through   -
>   default show, vibeterm: hide. [...]
> - show opencode logo: yes/no, default yes, vt no
> - position of the prompt screen: middle, top, bottom. if bottom: prompt
>   field, as you type it, will grow up. top: will grow down. middle: curernt
>   behavior. for bottom/top positioning, opencode logo is stitched to the
>   prompt field will move with the prompt field, always above it, wherehver
>   the prompt field ends up.

## Goals

- The prompt never grows past the screen, on the home and the session screen.
- `prompt.min_height`; `prompt.min_height`, `max_height`, `max_width` accept
  `"1%"`-`"100%"` of the room the prompt has after every other element's
  guaranteed rows (or of the home column's width).
- The gap above the logo shrinks to one row, never stays at four.
- `home.logo`, `home.tips`, `home.prompt_position` (`middle` default, `top`
  grows down, `bottom` grows up on the footer, logo above, tip above the logo).
- A set `home.tips` decides on every start; the Show/Hide tips command then
  lasts until exit. Unset, the command is remembered in kv.json.
- `home.prompt_min_height` / `home.prompt_max_height` size the home prompt
  apart from the session prompt, each falling back to `prompt.*`.
- Defaults match upstream; Vibeterm's defaults (tips and logo hidden) are
  written by opencode-tools, not by this fork.

## Non-goals

- `prompt.max_width` stays home-only; the session prompt spans the transcript.

## Rationale and constraints

- The overflow is upstream's: `v1` sizes the textarea to `max_height` with no
  bound and gives the home prompt box `flexShrink={0}`. Fixed upstream in PR
  #54948 (issue #54946); the options are PR #54949 (issue #54947).
- Yoga does not shrink a box that has a `height`, so the old `flexShrink`
  gaps never gave way; `TuiLayout.homeStack` computes the gaps and the tips
  block in proportion instead, and the TUI sets them explicitly.
- An empty opentui box is a row tall: the spacers get `height={0}`, hidden
  tips render no box, and an empty `home_bottom` counts as 0 rows.
- The prompt measures its chrome (`anchor.height - input.height`) in a
  microtask after layout: read in `onSizeChange` it oscillated, because
  renderables resize one at a time during a pass.
- The instant startup frame uses the same `TuiLayout` functions; a parity test
  compares it with the rendered TUI.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `7a377b7324` | 2026-10-12 | Prompt `space`, clamp, `min_height`, percentages, home stack, logo gap 1, logo gives way on a tiny terminal, `home.logo`/`tips`/`prompt_position`, instant parity, docs | `TuiLayout.size`/`promptRows`/`promptChromeRows`/`homePromptSpace`/`homeLogoFits`/`sessionPromptSpace`/`homeStack`/`homeTipsShown` in `packages/tui/src/layout.ts`; `PromptProps.space` and `measureChrome` in `component/prompt/index.tsx`; `routes/home.tsx`; column `onSizeChange` and `promptSpace` in `routes/session/index.tsx`; `feature-plugins/home/tips.tsx`; `Prompt`/`Home` in `config/index.tsx`; `instant/config.ts`, `instant/frame.ts` (`promptGeometry(..., space)`, `layout`), `instant/index.ts` (`tips`); `test/layout.test.ts`, `test/routes/home-layout.test.tsx`, `test/instant/config.test.ts` |
| `f77943745f` | 2026-10-12 | `home.tips` wins over kv `tips_hidden`; bottom puts the tips above the logo so the prompt sits on the footer; `home.prompt_min_height`/`prompt_max_height` | `TuiLayout.homeTipsShown`, `homeStack` (`tipsAbove`, `logoTop`, `promptTop`) in `layout.ts`; `toggle` in `feature-plugins/home/tips.tsx`; `tips()` in `routes/home.tsx`; `rows` in `component/prompt/index.tsx`; `homePromptMinHeight`/`MaxHeight` in `instant/config.ts` and `promptGeometry` in `instant/frame.ts`; `Home` in `config/index.tsx` |

## Verification

- packages/tui: typecheck clean; full suite 603 pass, 0 fail after the rebase
  onto `091e060773`. packages/opencode typecheck clean.
- `test/routes/home-layout.test.tsx` runs the real app at 100x30, 60x16, 60x12,
  120x50, 80x20 and 80x12, each position, hidden logo and tips, the kv toggle,
  `min_height` and percentages, and compares logo row, prompt row and text
  rows with `InstantFrame.layout`/`sessionLayout` for the same input.
- Real PTY on a throwaway tmux socket with isolated `XDG_*` dirs: 100x30 with
  `max_height: 999` and 40 lines stops at the footer with one row above the
  logo; resize to 60x14 drops the logo and keeps the status row above the
  footer; `top` + `min_height: 3` + `max_height: "50%"` + `max_width: "80%"`
  gives a 3-row start, 10-row cap and 76 columns.

## Timeline

- 2026-10-12 [`ses_ece469f46ffeIkbDfxO1jJY6D6`](../sessions/2026-10-12-home-screen-layout.md) -
  initial build. Evidence: `7a377b7324`, that session's Verification.
- 2026-10-12 [`ses_ece4671adffe4Y4d8Yv35NSjXh`](../sessions/2026-10-12-v1-v2-patch-rig.md) -
  rig run: `prompt-fit-screen` and `home-layout-options` proved on `v1.19.0` (`prompt-fits-screen`, `home-prompt-top`); prompt fit superseded on v2, layout options cost L. See the [matrix](../README.md#tui-patches-on-v1-and-v2).
- 2026-10-12 [`ses_ece469f46ffeIkbDfxO1jJY6D6`](../sessions/2026-10-12-home-screen-layout.md) -
  vt-252 regressions: a leftover kv `tips_hidden: false` beat `home.tips: false`,
  and at `bottom` the tips block (3 padding rows and the tip) sat between the
  prompt and the footer. Fixed in `f77943745f`, with the per-screen home prompt
  heights; PR #54949 amended to `115c96ec28`. Evidence: that session's
  "Regressions on vt-252".

## Current maintenance notes

- Drop the fork commit's upstream parts once PRs #54948 and #54949 (or v2
  equivalents) land; the instant-frame half stays with the instant prompt.
- opencode-tools `1cb6027` writes `home.tips: false` and `home.logo: false`
  once per machine (`_lib/opencode-tui-knobs/defaults.ts`).

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- Classify the customization as preserved, conflicted, superseded, or removed.
- Reverse any deliberate uncommitted patch before merging, then reapply its
  canonical patch afterward.
- Regenerate derived clients or schemas instead of editing generated files.
- Run the feature's focused tests and affected package typechecks.
- Build through the host's canonical installer and verify the installed binary.
- Confirm protected services kept the same PID and start timestamp.
- Link a new timeline row to the current session record.
- Update `Last checked against upstream`.
