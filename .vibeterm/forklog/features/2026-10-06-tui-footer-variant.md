# Show the turn's variant in assistant message footers

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-footer-variant` (`b762567377` on upstream `dev` `a697115b20`, the upstream PR head); landing branch `footer-variant-land`
- First local commit: `bd9676d499`
- Current local commit(s): `bd9676d499`; the render now lives in item 24's `1ca196f2b2` footer list, dimmed by its `efc7b3db27`
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `a697115b20` (upstream `dev`)
- Upstream: issue [#53846](https://github.com/anomalyco/opencode/issues/53846), PR [#53848](https://github.com/anomalyco/opencode/pull/53848) against v1 `dev`. Its body opens with the user's note that v1 is the maintenance branch and a v2 version follows once their plugin setup runs on v2. **Needs a v2 port later.**

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
| `efc7b3db27` | 2026-10-07 | variant in the muted color like the other footer details (item 24's commit, `ses_ee68aab01ffei41gwUGJ5ESj6W`) | the `variant` entry of `details()` in `AssistantMessage` in `packages/tui/src/routes/session/index.tsx`, `fg: theme.textMuted` |

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

- 2026-10-07
  [`ses_ee68aab01ffei41gwUGJ5ESj6W`](../sessions/2026-10-07-tui-footer-elements.md)
  - `1ca196f2b2`: the variant `Show` is replaced by the `variant` entry of `details()`; `footer_variant: true` is the legacy alias of `footer.variant: "all"`; `efc7b3db27` mutes it. See [footer elements](./2026-10-07-tui-footer-elements.md).

- 2026-10-06 `ses_eec44cf7effeFCqQefM0NkWLaW` - built ahead of the user's
  answer as local `5e4b1d22f7` on `tui-footer-variant`; recorded as pending
  in [the item 15 session record](../sessions/2026-10-06-tui-model-label.md).
- 2026-10-07
  [`ses_eec44cf7effeFCqQefM0NkWLaW`](../sessions/2026-10-07-tui-footer-variant.md)
  - `bd9676d499`: land with docs; build and install on desktop and m4max,
    `footer_variant: true` set in their `tui.json`.
  - `021d0625ad` on `tui-footer-variant` rebased onto upstream `dev`
    `a697115b20` with the tui.mdx bullet, no AI trailers; upstream issue
    #53846 and PR #53848, opened after the user asked for v1 PRs again.

  - User feedback: "i don't like the yellow color we're using there. all
    other footer [parts] except agent name are dimmed, let's preserve that."
    `tui-footer-variant` amended to `b762567377` (variant in
    `theme.textMuted`), force-pushed with lease to both remotes; PR #53848
    is closed by the bot and GitHub does not move a closed PR's head, so it
    still shows `021d0625ad`. `dev-nowaker` got the same change as item 24's
    `efc7b3db27`; built and installed `1.18.34-vt-170-907b3bc518` on desktop
    and m4max. Isolated `capture-pane -e`: before, `high` in
    `38;2;245;167;66` (warning); after, the whole
    ` · QA Model · high · 4.3s` run in `38;2;128;128;128`.

## Current maintenance notes

- Port to v2 once Vibeterm core runs on v2. Drop the fork commit if PR
  #53848 (or an equivalent) reaches upstream `dev`.
- Item 24 (`ses_ee68aab01ffei41gwUGJ5ESj6W`) folds footer elements into one
  `footer` setting and keeps `footer_variant: true` as a legacy alias.
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
