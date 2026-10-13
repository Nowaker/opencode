# tui.json decides over remembered runtime toggles

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-config-precedence` (integration); carried onto
  each owning feature branch on `nowaker-github`: `tui-context-display`,
  `tui-sidebar-pin-title`, `sidebar-session-id`, `tui-submit-scroll`,
  `tui-turn-timing`, `tui-footer-elements`, `tui-sidebar-drag`,
  `tui-tool-collapse`, `home-layout-options`
- First local commit: `2bee88edd6`
- Current local commit(s): `2bee88edd6`..`24a5bd2498` (nine commits)
- Upstream base when introduced: `v1.19.0` (`dfb56f76c7`)
- Last checked against upstream: `v1.19.0` (`dfb56f76c7`)

## Original request

> well we need to make sure that whatever we introduce into tui conf isn't
> duplicate of existing functioinality or kind of interfering with it. screen
> all tui conf settings, check for similar gotchas in the code, and work out
> any differences with reasonable outcomes.

Trigger: desktop `kv.json` held `"tips_hidden": false` and `tui.json` held
`"home": {"tips": false}`; the kv value won and the tip showed.

## Goals

- One rule for every tui.json key that also has a runtime toggle (palette
  command, slash command, click, drag): **set in tui.json, the key decides on
  every start and its toggle lasts until opencode exits, with a toast saying
  so; unset, the toggle is remembered in `kv.json`.**
- A value a toggle remembered on an earlier run never overrides a tui.json
  value set later, so Vibeterm's seeded `home.tips: false` holds.
- Toggling back to the tui.json value clears the session override.

## Non-goals

- No migration of either host's `tui.json` or `kv.json`: under the rule both
  hosts' existing files already resolve to the tui.json values.
- Keys without a toggle (`footer.*` besides time/duration, `datetime_format`,
  `syntax.*`, `prompt.*`, `home.logo`, `home.prompt_*`, `revert.files`,
  `transcript.*`, `usage.*`, `startup.*`) are unchanged: nothing overrides them.
- Upstream kv toggles with no tui.json key (thinking, tool details, scrollbar,
  animations, file context, diff wrap, terminal title, paste summary) are
  unchanged.

## Rationale and constraints

- `kv.json` is written whole from memory by every running TUI, and the fork's
  older readers (`kv.get("x", tuiConfig.y)`) let any stored value win. Once a
  toggle had been used, a later tui.json edit, or Vibeterm's enforced value,
  was silently ignored.
- Rejected: Vibeterm clearing kv keys through its maintained-config path. Every
  open tab would write the value back from memory on its next kv write.
- Rejected: a kv "default from config" read. The default would be persisted
  by the next unrelated kv write and shadow the config again.
- The rule matches what `footer.*`/`timestamps` already did (session-only
  override map) and what item 34 landed for `home.tips` (`f77943745f`).

## Inventory

| tui.json key | Overlapping mechanism | Class | Resolution |
|---|---|---|---|
| `home.tips` | kv `tips_hidden`, **Show/Hide tips** | silent override | config-first (`f77943745f`, item 34) + toast `d6e2c3dff0` |
| `sidebar.context` | kv `sidebar_context`, header click, **Compact/Expand sidebar context** | silent override | config-first `2bee88edd6` |
| `sidebar.pin_title` | kv `sidebar_pin_title`, `/pin-title` | silent override | config-first `27d0b208a1` |
| `sidebar.session_id` | kv `sidebar_session_id`, `/session-id`, instant session screen | silent override | config-first `e3d680468f` |
| `keep_scroll_on_submit` | kv `keep_scroll_on_submit`, `/keep-scroll` | silent override | config-first `8137a56479` |
| `turn_timing.time` / `.duration` | kv `turn_timing_time` / `turn_timing_duration`, `/turn-times`, `/turn-durations` | silent override | config-first `e64c11cd60`; `footerConfigured` per element and type |
| `footer.time`, `footer.duration`, `timestamps` | kv `timestamps`, `/timestamps`, `/turn-times`, `/turn-durations` | already config-first | toast added `e64c11cd60` |
| `sidebar.order` | kv `sidebar_order`, header drag, **Reset sidebar order** | silent override | config-first `267cb17a0e` |
| `tool_output.collapse` (`generic`, tool names) | kv `generic_tool_output_visibility`, **Show/Hide generic tool output** | interaction: output hidden outright, limit inert | naming `generic` or the tool shows output collapsed `084beaa663` |
| `prompt.paste_summary` | kv `paste_summary_enabled`, opencode.json `experimental.disable_paste_summary` | interaction: different switches (on/off vs thresholds) | none needed |
| `syntax.tool_input` / `syntax.tool_output` | `generic_tool_output_visibility` | interaction | handled by `toolOutputReach` (`4c00002ca0`, syntax session) |
| `mouse` | env `OPENCODE_DISABLE_MOUSE` | env kill switch | none needed: env only disables |
| `startup.instant_prompt` / `early_input` | none | - | - |
| `theme` (upstream) | kv `theme` | config already wins | none |

Vibeterm (opencode-tools `a0aff80`): the knob catalog lists the toggles in
`KV_TOGGLES` and a settings row shows a remembered toggle only while the key is
unset (`TUI toggle remembered: kv.json …`). Item 34 moved
`_lib/opencode-tui-config`'s `home.tips` reader to tui.json-first (`892927e`).

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `2bee88edd6` | 2026-10-12 | `sidebar.context` decides; toggle session-only | `feature-plugins/sidebar/context.tsx` `mode` |
| `27d0b208a1` | 2026-10-12 | `sidebar.pin_title` decides | `routes/session/sidebar.tsx` `sidebarTitlePinned` |
| `e3d680468f` | 2026-10-12 | `sidebar.session_id` decides, instant screen too | `layout.ts` `sidebarShowsSessionId`, `sidebarShowsSessionID` |
| `8137a56479` | 2026-10-12 | `keep_scroll_on_submit` decides | `routes/session/index.tsx` `keepScrollToggled` |
| `e64c11cd60` | 2026-10-12 | legacy `turn_timing` decides; footer toggles toast and outlive a session switch | `config/index.tsx` `footerConfigured`, `footerSelections` |
| `267cb17a0e` | 2026-10-12 | `sidebar.order` decides; drag session-only | `plugin/slots.tsx` `draggedOrder`, `resetSidebarOrder` |
| `084beaa663` | 2026-10-12 | `tool_output.collapse` shows generic output | `config/index.tsx` `genericToolOutputShown` |
| `d6e2c3dff0` | 2026-10-12 | tips toggle toast | `feature-plugins/home/tips.tsx` `toggle` |
| `24a5bd2498` | 2026-10-12 | tui.mdx "Settings with a toggle"; schema descriptions | `packages/web/src/content/docs/tui.mdx` |

## Verification

See the [session record](../sessions/2026-10-12-tui-config-precedence.md#verification).

## Timeline

- 2026-10-12 [`ses_ecd4cb9a4ffexYnAMRzHjPZDUp`](../sessions/2026-10-12-tui-config-precedence.md) -
  audit, rule, nine commits on `dev-nowaker`, carried onto nine owning
  branches; opencode-tools catalog. Evidence: that session's Verification.

## Current maintenance notes

- A new tui.json key with a toggle must follow the rule: read
  `sessionOverride() ?? config ?? kv.get(key, default)`, and only `kv.set`
  while the config key is unset. Add it to the tui.mdx table and to
  opencode-tools `KV_TOGGLES` (`_lib/opencode-tui-knobs/catalog.ts`).
- Never read `kv.get("x", tuiConfig.y)` or `kv.signal` with a config-derived
  default for such a key.

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
