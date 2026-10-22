# Vibeterm section above a delivered prompt

## Identity

- Workday: 2026-10-22
- Session: `ses_eaca3043cffex00KfTm0HE9UJr`
- Agent/platform: opencode (anthropic/claude-opus-5-5) / linux
- Repository: `~/projekty/webapps/opencode`; opencode-tools for the brand color
- Integration branch: `dev-nowaker`
- Development branch(es): `vt-section` (fork); `feat/brand-color` (opencode-tools)
- Upstream base: `dfb56f76c7` (upstream `v1`, contains `v1.19.0`); fork tip before `2b8dd77d5a`
- Source result commit(s): `6df5f316a7`
- Forklog commit: this file's introducing commit

## User requests

Coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, relaying the user's review of the 2026-10-19 view; the condensed words are quoted in [the feature record](../features/2026-10-19-delivery-provenance-view.md#redesign-request-2026-10-22).

## Goals

- One box in two stacked parts: a Vibeterm section on top in Vibeterm's brand color, the prompt below in the agent color, no gap.
- Separate hover and click per part; a click in the Vibeterm section never opens Message Actions or Revert.
- Tag lines hidden; a click expands the full stored record; the bottom `Delivery provenance` row removed.
- The brand color defined once in Vibeterm and inherited by opencode's own color setting.

## Constraints and non-goals

- No tab restarts. Producer fixes (a queued prompt that prepends the profile-override marker as a separate block with no stored record, as in `msg_165a6ae08001aRHtLyrZiGnKgq`) belong to `ses_ebc8f2bc4ffehcETvBMsNJHPhX`.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| opencode fork | `dev-nowaker` | `2b8dd77d5a` | `6df5f316a7` | fast-forward from `vt-section`, pushed to `origin` |
| opencode-tools | `master` | `dfbd956cd6d` | `1483d7b3e73` | rebase `feat/brand-color`, fast-forward, push; m4max already at it |

`nowaker-github/dev-nowaker` diverged before the push: it holds `1cdfe76abb`, `843f8b658e`, `5b5c04ba81` (MCP OAuth, authored by Mark Brown, session `ses_eaba85458ffeY2n7wGqgOYt27p`) that `origin` lacks. The push there waits on question `qst_165dd818d001UFatCmA3wlhlks`.

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Expandable delivery provenance on user messages](../features/2026-10-19-delivery-provenance-view.md) | redesigned | tests and manual surface in the feature's Verification |

## Other delivered work

- opencode-tools `1483d7b3e73`: `sidebar.brandColor` (256-color index, default 13) colors `VIBETERM` in the top bar; `opencodeTui.vibeterm_color`'s Vibeterm default follows it; knob catalog regenerated with `vibeterm_color`.

## Verification

- See the feature's 2026-10-22 Verification entries.
- opencode-tools: `bun test _lib/opencode-tui-knobs vibeterm-opencode-client/settings-tui-knobs.test.ts vibeterm-opencode-client/settings-focus.test.ts` - 52 pass after the rebase. The settings suite's other failures and `focus-selector-tmux.test.ts`'s two failures are identical on untouched master.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard ~/projekty/webapps/opencode-build/build.sh` (desktop), the same with `~/projects` on m4max.
- Installed artifact: `1.19.0-vt-373-dfb56f76c7` on desktop and m4max; v2 migration guard gate PASSED on both (desktop npm `opencode-ai@1.19.3` and `@opencode/cli@2.0.32` cached; m4max cached `1.19.0` and `2.0.29`, its disk-reserve policy refused fresh downloads).
- Running services: not restarted; existing tabs keep their loaded binary until restarted.

## Commit provenance

- `6df5f316a7` - feat(tui): draw a delivered prompt's Vibeterm blocks as their own section
- Required trailer: `AI-Session-ID: ses_eaca3043cffex00KfTm0HE9UJr`

## Unknowns and blocked verification

- The GitHub mirror push waits on `qst_165dd818d001UFatCmA3wlhlks`.
