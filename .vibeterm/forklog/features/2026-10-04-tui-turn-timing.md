# Per-turn completion time and duration in the TUI

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-turn-timing` (off upstream `dev` `907b3bc518`; also the upstream PR head)
- First local commit: `17dca85fb5`
- Current local commit(s): `17dca85fb5`, `d80de8e705`
- Upstream base when introduced: `907b3bc518` (upstream `dev`)
- Last checked against upstream: `907b3bc518` (upstream `dev`)
- Upstream: issue [#53192](https://github.com/anomalyco/opencode/issues/53192), PR [#53195](https://github.com/anomalyco/opencode/pull/53195)

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (effort item 3),
quoting the user:

> each ai turn should show time (if today), datetime (if not today) and how
> long it took (e.g. 2h3m). additionally, final ai messages (after a series of
> turns), should have both the time it took to generate final response AND the
> entire interaction since the prompt that triggered this turn. configurable in
> tui and in /tui commands. defaults: matching current defaults, whatever they
> are.

## Goals

- Every completed assistant turn can show when it finished
  (`Locale.todayTimeOrDateFirst`: time of day if today, otherwise the date
  then the time, `10/4/2026 11:26 PM`) and how long it took
  (`completed - created`).
- The final turn shows its own duration and keeps the existing total since
  the prompt, labelled `total`.
- Configurable in `tui.json` and toggleable at runtime.

## Non-goals

- Defaults unchanged: both options off, so only the final message has a
  footer with the total, as upstream.
- Duration format stays upstream `Locale.duration` (`8.3s`, `3m 12s`,
  `2h 3m`); not reformatted to `2h3m`.
- No change to `/timestamps`, which still covers user messages only.

## Rationale and constraints

- Vanilla `907b3bc518` renders no footer on intermediate tool-call turns and
  only the prompt-to-completion total on the final one.
- Two independent booleans, `turn_timing.time` and `turn_timing.duration`,
  instead of a mode enum: the two facts are wanted independently.
- Runtime toggles `/turn-times` and `/turn-durations` (palette entries,
  keybinds `session_toggle_turn_time` / `session_toggle_turn_duration`,
  default `none`). A toggled value persists in `kv.json` and wins over
  `tui.json`, which only supplies the default; the value is read with
  `kv.get` rather than `kv.signal` so the default is never written to kv.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `17dca85fb5` | 2026-10-04 | `turn_timing` schema; `showTurnTime` / `showTurnDuration` memos, palette/slash commands, context fields; `AssistantMessage` footer shown for every completed turn when either is on, with time, per-turn duration and `total` suffix; docs and config test | `TurnTiming` in `packages/tui/src/config/index.tsx`; `AssistantMessage` footer in `packages/tui/src/routes/session/index.tsx`; `packages/tui/src/config/keybind.ts` |
| `d80de8e705` | 2026-10-04 | Turns not finished today render date first (`10/4/2026 11:26 PM`) instead of `11:26 PM · 10/4/2026`; new `Locale.todayTimeOrDateFirst`, `todayTimeOrDateTime` unchanged for `/timestamps` and `opencode session list`; unit test | `todayTimeOrDateFirst` in `packages/tui/src/util/locale.ts`; turn-time span in `AssistantMessage` |

## Verification

- `bun typecheck` in `packages/tui` and `packages/opencode` - exit 0 on
  `tui-turn-timing` and on the landing branch.
- `packages/opencode/test/config/tui.test.ts`: new `loads turn timing config`
  passes (30 pass); 4 plugin-merge tests fail identically on pristine
  `907b3bc518`. `packages/tui/test/config.test.tsx` 9/9.
- Manual surface: `bun dev` in throwaway tmux socket `oc-tui-timing`
  (140x50), isolated `XDG_*` dirs, a fake OpenAI-compatible provider that
  answers each prompt with two `glob` tool-call steps and a final text step.
  Vanilla: only `▣  Build · Fake · 15.8s` on the final message. Patched with
  defaults: identical. Both toggles on: `· 1:07 PM · 8.3s`, `· 1:07 PM ·
  3.5s`, `· 1:07 PM · 3.7s · 15.6s total`. Time only: `· 1:07 PM` on each,
  final `· 1:07 PM · 15.6s`. `tui.json` `{"turn_timing":{"duration":true}}`
  with no kv override, after restart: durations shown from the start.
- Date order (`d80de8e705`): `packages/tui/test/util/locale.test.ts` 2/2.
  In the isolated rig, one session's first-turn rows were shifted back 24h
  in the scratch DB and a second prompt was sent today. Before:
  `· 4:59 AM · 10/4/2026 · 7.1s`. After (source and installed desktop
  `1.18.34-vt-91-907b3bc518`): `· 10/4/2026 4:59 AM · 7.1s` and
  `· 10/4/2026 4:59 AM · 1.9s · 9.1s total`; today's turns
  `· 5:09 AM · 14.2s` and `· 5:09 AM · 2.0s · 16.4s total`.

## Timeline

- 2026-10-04
  [`ses_ef81c1485ffeC5Sb59U9mVI77g`](../sessions/2026-10-04-tui-turn-timing.md)
  - `17dca85fb5`: introduce (cherry-pick of `2fda6d8d7a`, conflicts with
    `keep_scroll_on_submit` resolved by keeping both); open upstream issue
    #53192 and PR #53195.
  - Build and install: desktop `1.18.34-vt-70-907b3bc518`, m4max
    `1.18.34-vt-71-907b3bc518`; host `tui.json` left at defaults.
  - `d80de8e705`: date before time for turns not finished today, on user
    feedback ("datetime good, timedate weird"); the same change amended into
    the PR head (`b14b75e5d8`). Build and install: desktop and m4max
    `1.18.34-vt-91-907b3bc518`.

## Current maintenance notes

- Drop both fork commits once PR #53195 (or an equivalent) is in upstream
  `dev`.
- Adjacent to `keep_scroll_on_submit` in the `Info` schema and the session
  command list; an upstream bump touching either may conflict textually.

### Upstream integration checklist

- Locate `TurnTiming` and `turn_timing` in `packages/tui/src/config/index.tsx`.
- Locate `showTurnTime`, `showTurnDuration` and the `completed` memo in
  `packages/tui/src/routes/session/index.tsx`.
- Run `bun typecheck` in `packages/tui`.
- Run `/turn-times` and `/turn-durations` on a multi-step turn and check
  every assistant footer.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
