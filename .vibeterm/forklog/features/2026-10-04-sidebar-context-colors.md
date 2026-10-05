# Color context usage and cost by thresholds

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-context-colors` (stacked on `tui-context-display` `7d9790cb1c`; also the upstream PR head)
- First local commit: `dc76be7263`
- Current local commit(s): `dc76be7263`, `6f6107700b`
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

Follow-up relayed by the coordinator on 2026-10-05 (04:38, still the
2026-10-04 workday), quoting the user:

> colored context usage - make those colors also apply to bottom ctx and
> usage indicator and for money threshold there too

## Goals

- `tui.json` `usage.context_color`: `"plain"` (default, upstream rendering)
  or `"colored"`; tokens and percent used share one color.
- `usage.context_thresholds` (default `[60, 70, 80, 90]`) and
  `usage.cost_thresholds` (default none): at or below the first threshold
  `textMuted`, above the first `warning`, above the last `error`, thresholds
  in between blend with `tint`.
- Colors the sidebar Context block (expanded and every compact width
  variant) and the prompt footer's `95.0K (95%) · $3.70`; separators stay
  muted.
- Desktop and m4max `tui.json`: `usage.context_color: "colored"`, no
  threshold keys.

## Non-goals

- No change to how tokens, percent, or cost are computed.

## Rationale and constraints

- An ascending list covers both "warn above $5" (`[5]`) and a ramp; order is
  irrelevant because a value counts the thresholds it exceeds.
- Theme colors only; the ends return the theme objects rather than a blend,
  which keeps palette-indexed `system` theme colors intact.
- The keys moved from `sidebar.*` to a top-level `usage` struct once they
  colored the footer too; the field names are unchanged.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `dc76be7263` | 2026-10-04 | threshold coloring of tokens, percent and cost in both Context layouts; three `sidebar` options; docs line | `levelColor` and `View` in `packages/tui/src/feature-plugins/sidebar/context.tsx`; `SidebarContextColor`, `SidebarContextThresholdsDefault`, `Sidebar` in `packages/tui/src/config/index.tsx` |
| `6f6107700b` | 2026-10-04 | prompt footer usage line colored by the same rule; threshold logic shared; keys moved to `usage.*` | `levelColor`, `usageColors` in `packages/tui/src/util/usage-color.ts`; `usage` memo in `packages/tui/src/component/prompt/index.tsx`; `Usage`, `UsageContextColor`, `UsageContextThresholdsDefault` in `packages/tui/src/config/index.tsx` |

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
- Footer (`6f6107700b`): `bun test test/util/usage-color.test.ts
  test/config.test.tsx test/keymap.test.tsx` (15 pass) and `bun typecheck`
  on `tui-context-colors` and `dev-nowaker`. tmux socket `oc-tui-ctxfoot`,
  same fake provider, `usage: { context_color: "colored", cost_thresholds:
  [1, 2, 3] }` beside `{}`: plain footer all `#808080`; colored footer 65%
  `#f5a742`, 75% `#ee9353`, 85% `#e78064`, 95% `#e06c75`, cost `$1.15`
  `#f5a742` to `$3.70` `#e06c75`, separator `#808080`; sidebar unchanged.

## Timeline

- 2026-10-04
  [`ses_ef6439100ffea6UZ1MqYyvXDjR`](../sessions/2026-10-04-sidebar-context-colors.md)
  - `dc76be7263`: introduce; open upstream issue #53263 and PR #53264;
    build and install on desktop and m4max (`vt-89`); `context_color:
    "colored"` set in both hosts' `tui.json`.
- 2026-10-04
  [`ses_ef6439100ffea6UZ1MqYyvXDjR`](../sessions/2026-10-04-sidebar-context-colors.md)
  - `6f6107700b`: color the prompt footer usage line, share `levelColor` via
    `util/usage-color.ts`, move the keys to `usage.*`; PR #53264 amended to
    `94d6044030`; build and install on desktop and m4max (`vt-94`); both
    hosts' `tui.json` migrated to `usage.context_color: "colored"`.

## Current maintenance notes

- Drop the fork commit once PR #53264 (or an equivalent) is in upstream
  `dev`; it depends on #53205.

### Upstream integration checklist

- Locate `levelColor`/`usageColors` in `packages/tui/src/util/usage-color.ts`,
  their callers in `feature-plugins/sidebar/context.tsx` and
  `component/prompt/index.tsx`, and the `Usage` struct in
  `packages/tui/src/config/index.tsx`.
- Run `bun typecheck` and `bun test test/util/usage-color.test.ts
  test/config.test.tsx` in `packages/tui`.
- With `usage.context_color: "colored"`, check that a session above 60%
  shows warning-colored tokens and percent in the sidebar and the footer.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
