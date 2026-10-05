# Color sidebar Context usage and cost by thresholds

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-context-colors` (stacked on `tui-context-display` `7d9790cb1c`; also the upstream PR head)
- First local commit: `dc76be7263`
- Current local commit(s): `dc76be7263`
- Upstream base when introduced: `907b3bc518` (upstream `dev`)
- Last checked against upstream: `907b3bc518` (upstream `dev`)
- Upstream: issue [#53263](https://github.com/anomalyco/opencode/issues/53263), PR [#53264](https://github.com/anomalyco/opencode/pull/53264) (builds on #53205)

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (effort item 5),
quoting the user:

> optional switch for coloring context size/use %; default as is. another
> option - colored, with our threshold values - come up with something nice,
> e.g. up to 60% standard text color, and above, colors going towards red.
> same for dollar value, default nothing, but ability to define some
> threshold for different 'warning' levels. for my config here: context:
> colored, with default thresholds. money: no threshold.

## Goals

- `tui.json` `sidebar.context_color`: `"plain"` (default, upstream
  rendering) or `"colored"`; tokens and percent used share one color.
- `sidebar.context_thresholds` (default `[60, 70, 80, 90]`) and
  `sidebar.cost_thresholds` (default none): at or below the first threshold
  `textMuted`, above the first `warning`, above the last `error`, thresholds
  in between blend with `tint`.
- Colors both the expanded block and every compact width variant; compact
  separators stay muted.
- Desktop and m4max `tui.json`: `sidebar.context_color: "colored"`, no
  threshold keys.

## Non-goals

- The prompt footer's `75.0K (75%) · $0.75` stays uncolored.
- No change to how tokens, percent, or cost are computed.

## Rationale and constraints

- An ascending list covers both "warn above $5" (`[5]`) and a ramp; order is
  irrelevant because a value counts the thresholds it exceeds.
- Theme colors only; the ends return the theme objects rather than a blend,
  which keeps palette-indexed `system` theme colors intact.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `dc76be7263` | 2026-10-04 | threshold coloring of tokens, percent and cost in both Context layouts; three `sidebar` options; docs line | `levelColor` and `View` in `packages/tui/src/feature-plugins/sidebar/context.tsx`; `SidebarContextColor`, `SidebarContextThresholdsDefault`, `Sidebar` in `packages/tui/src/config/index.tsx` |

## Verification

- `bun typecheck` and `bun test test/feature-plugins/sidebar-context.test.ts
  test/config.test.tsx test/keymap.test.tsx` in `packages/tui` - pass on
  `tui-context-colors` and on `dev-nowaker`.
- Manual surface: throwaway tmux socket `oc-tui-ctxcolor`, isolated `XDG_*`,
  fake OpenAI-compatible provider on 127.0.0.1 reporting 50k-95k of a 100k
  context. Default config: all values `#808080`. `context_color: "colored"`,
  `cost_thresholds: [1, 2, 3]`: 50% muted, 65% warning `#f5a742`, 75% and
  85% blends, 95% error `#e06c75`; compact at sidebar widths 60/42/26
  colored the same with muted ` · ` separators.

## Timeline

- 2026-10-04
  [`ses_ef6439100ffea6UZ1MqYyvXDjR`](../sessions/2026-10-04-sidebar-context-colors.md)
  - `dc76be7263`: introduce; open upstream issue #53263 and PR #53264;
    build and install on desktop and m4max (`vt-89`); `context_color:
    "colored"` set in both hosts' `tui.json`.

## Current maintenance notes

- Drop the fork commit once PR #53264 (or an equivalent) is in upstream
  `dev`; it depends on #53205.

### Upstream integration checklist

- Locate `levelColor` in
  `packages/tui/src/feature-plugins/sidebar/context.tsx` and the `Sidebar`
  struct in `packages/tui/src/config/index.tsx`.
- Run `bun typecheck` and `bun test test/feature-plugins/sidebar-context.test.ts
  test/config.test.tsx` in `packages/tui`.
- With `sidebar.context_color: "colored"`, check that a session above 60%
  shows warning-colored tokens and percent.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
