# Show the turn's variant in assistant message footers

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-footer-variant` (`5e4b1d22f7` on upstream `dev` `ecc4916b5a`, local only, never pushed); landing branch `footer-variant-land`
- First local commit: `bd9676d499`
- Current local commit(s): `bd9676d499`
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `ecc4916b5a` (upstream `dev`)
- Upstream: none. No issue or PR, by the user's decision: v1 PRs close once their v2 replacements open, and TUI ports to v2 wait until Vibeterm core runs on v2. **Needs a v2 port later.**

## Original request

Item 14 relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, quoting the
user:

> ability to show reasoning; tui knob, default off, here: on

Clarified by the user on 2026-10-07, relayed by the coordinator:

> i don't see variants shown here: `▣  Sisyphus - Ultraworker ·
> anthropic/claude-opus-5-5 · 9:16 PM · 45.5s` - are they not known, or not
> configured for tui to show to me here on desktop? whichever it is, fix it

## Goals

- `footer_variant: true` in `tui.json` shows the variant a turn ran with
  (its reasoning effort, e.g. `high`, `max`) after the model in every
  assistant message footer, before any turn time and duration.
- Turns without a variant, and the default (`false`), render exactly as
  before.

## Non-goals

- No runtime toggle or slash command; the setting is read from `tui.json`.
- The prompt line below the input is unchanged: upstream already shows the
  selected variant there (`Build · anthropic/claude-opus-5-5 · high`).
- Thinking-block visibility: upstream's `/thinking` (kv `thinking_mode`)
  already covers it, and both hosts hold `thinking_mode: "show"`.

## Rationale and constraints

- The variant was known, not missing: every assistant message stores it
  (`variant: "high"` on the desktop sessions checked in `opencode.db`), and
  upstream renders only the model in the footer.
- The footer reads `message.variant`, so a past turn keeps the effort it ran
  with after the selection changes.
- Placement: model, then variant, then `turn_timing` time and duration, so
  the variant qualifies the model it follows.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `bd9676d499` | 2026-10-07 | `footer_variant` setting; variant in the assistant footer; tui.mdx | `Info.footer_variant` in `packages/tui/src/config/index.tsx`; the `ctx.tui.footer_variant && props.message.variant` `Show` between `{model()}` and the turn-time `Show` in `AssistantMessage` in `packages/tui/src/routes/session/index.tsx`; `footer_variant` bullet in `packages/web/src/content/docs/tui.mdx`; `test/config.test.tsx` |

## Verification

- `bun typecheck` and `bun test --timeout 60000` in `packages/tui` on
  `footer-variant-land`: 341 pass, 1 skip, 0 fail. At the default 5 s
  timeout `test/instant/editor.test.ts` "every editing action from every
  caret position" timed out at load average 82; it passes with a longer
  timeout and does not touch the footer.
- Pre-push full-repo typecheck: 30/30 on both pushes.
- Manual surface: isolated `XDG_*` and tool/plugin data dirs, throwaway
  tmux socket `oc-tui-footer-variant`, fake OpenAI-compatible providers
  `qa-alpha`/`qa-beta` streaming reasoning; turn one has no variant, turn two
  runs on `qa-beta` with `high`:
  - hosts' layout (`footer_variant`, `model_label: "id"`, `turn_timing`):
    `▣  Build · qa-alpha/qa-model · 9:31 PM · 3.6s · 3.7s total` and
    `▣  Build · qa-beta/qa-model · high · 9:32 PM · 143ms · 158ms total`
  - same without `footer_variant`:
    `▣  Build · qa-beta/qa-model · 9:32 PM · 231ms · 257ms total`
  - `footer_variant` alone: `▣  Build · QA Model · 2.7s` and
    `▣  Build · QA Model · high · 1.2s`
  - prompt line in every run: `Build · qa-beta/qa-model · high`.

## Timeline

- 2026-10-06 `ses_eec44cf7effeFCqQefM0NkWLaW` - built ahead of the user's
  answer as local `5e4b1d22f7` on `tui-footer-variant`; recorded as pending
  in [the item 15 session record](../sessions/2026-10-06-tui-model-label.md).
- 2026-10-07
  [`ses_eec44cf7effeFCqQefM0NkWLaW`](../sessions/2026-10-07-tui-footer-variant.md)
  - `bd9676d499`: land with docs; build and install on desktop and m4max,
    `footer_variant: true` set in their `tui.json`.

## Current maintenance notes

- Port to v2 once Vibeterm core runs on v2; no upstream PR for v1.
- Host setting: `"footer_variant": true` in `~/.config/opencode/tui.json` on
  desktop and m4max.

### Upstream integration checklist

- Confirm the `AssistantMessage` footer still renders the variant `Show`
  between the model and the turn-time `Show`.
- Run `test/config.test.tsx` and `bun typecheck` in `packages/tui`.
- Build through `.vibeterm/build.sh`; a turn on a variant footers
  `· <model> · high · <time> · <duration>`.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
