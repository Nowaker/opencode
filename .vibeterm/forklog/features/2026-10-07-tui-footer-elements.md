# Choose every message footer detail the same way, message ID included

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `footer-elements` (worktree off `dev-nowaker`); upstream branch `tui-footer-elements` (`cc947a75a7`, stacked on the #53195, #53654, #53639, #53848 and #53333 commits over upstream `dev` `663fbd7573`)
- First local commit: `1ca196f2b2`
- Current local commit(s): `1ca196f2b2`, `efc7b3db27`, `4c6be131b4`
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `663fbd7573` (upstream `dev`)
- Upstream: PR [#53877](https://github.com/anomalyco/opencode/pull/53877), closed by opencode-agent[bot] within a minute (v1 takes critical fixes only); kept current for others. Comment on [#50891](https://github.com/anomalyco/opencode/issues/50891#issuecomment-6053344669). **Needs a v2 port later.**

## Original request

Item 24 relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, quoting the
user:

> new tui option: show msgid in the footers. default false, for me all, other
> options list of elements it's being shown on (and maybe an entry for
> important ones? do we have similar switch for showing some other elements?
> generally make things consistent, so if we have important-onlt on
> time-elapsed, then we should have it on datetime-ended, and on msgid, etc. -
> apply to all these footer elements, consistenly)

Added the same evening:

> tui feature - i wanted time finished and time taken for tool calls. looks
> like not all of them get the footer. eg vtps here don't get it. i basically
> want whatever has msgid, it has submit date, and finish date, right? so that
> should be an option for all footer elements - to be included there. default
> of course false but i want to see it on all tool calls. its valuable for me
> to know how long vtps takes.

## Goals

- One `footer` object in `tui.json`, one key per detail: `agent`, `model`,
  `variant`, `time`, `duration`, `total`, `message_id`.
- Every key takes the same value: `true`/`"all"`, `false`/`"none"`,
  `"important"` (the ctrl+shift+up/down landmarks), or a list of the
  `timestamps` entry types (`user`, `assistant`, `text`, `reasoning`, `tool`,
  `error`, `compaction`), which may include `"important"`.
- `message_id` shows `msg_...` as selectable text on user, assistant and tool
  footers; default off.
- `tool` covers every tool call, whatever renders it (built-in, generic,
  plugin, MCP), from the part's own `time.start`/`time.end`.
- Unset, the transcript renders exactly as before; the older keys and the
  `/timestamps`, `/turn-times` and `/turn-durations` toggles keep working.
- Every footer detail is muted except the agent name.

## Non-goals

- No live elapsed timer on a running tool call.
- No new slash commands; the existing three toggles map onto `footer.time`
  and `footer.duration`.

## Rationale and constraints

- Before: `turn_timing.time`/`duration` were booleans, `timestamps` a type
  list, `footer_variant` a boolean, and agent, model and total had no setting.
  No message ID was shown anywhere.
- Vanilla upstream `dev` (`a697115b20`, isolated capture) footers read
  `▣  Build · QA Model · 4.4s`; tool calls, text and reasoning show no time.
- `"important"` reuses `navigationTargets(..., "landmark")`; a message-level
  entry counts when the message or any of its parts is a landmark.
- A block tool appended its time to the title, so a multi-line plugin argument
  (vtps's `prompt`) buried it at the end of the last line. The footer now gets
  its own line there and on inline rows whose arguments span lines.
- A key set in `footer` decides on every start and its toggle lasts until
  exit, as `timestamps` already did: `kv.json` usually holds a persisted
  `timestamps` value that would otherwise mask the config.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `1ca196f2b2` | 2026-10-07 | `footer` setting, value shape, legacy mapping, `message_id`, `"important"`; assistant footer drawn from one `details()` list; tui.mdx `Footer` and `Older footer settings` sections plus the missing `model_label` entry | `Footer`, `FooterValue`, `footerSelections`, `footerShows`, `footerConfigured` in `packages/tui/src/config/index.tsx`; `footer`/`toggleFooter` in `Session()` and `details()` in `AssistantMessage` in `packages/tui/src/routes/session/index.tsx`; `isLandmark` in `routes/session/navigation.ts`; `test/config.test.tsx`, `test/routes/session/navigation.test.ts` |
| `efc7b3db27` | 2026-10-07 | Variant drawn in `theme.textMuted` | `variant` entry of `details()` |
| `4c6be131b4` | 2026-10-07 | Every tool call takes `time`, `duration`, `message_id`; block tools footer on their last line; `footerBelow` for multi-line inline rows | `toolFooter`, `formatToolTimestamp`, `InlineToolRow.footerBelow`, `BlockTool` in `routes/session/index.tsx`; `test/cli/tui/inline-tool-wrap-snapshot.test.tsx` |

## Verification

- `bun typecheck` in `packages/tui` - exit 0 after each commit.
- `bun test --timeout 60000` in `packages/tui` on `1ca196f2b2` - 349 pass,
  1 skip, 0 fail; focused config/navigation/inline-tool tests after
  `4c6be131b4` - 51 pass, 0 fail. Upstream stack `cc947a75a7` - 45 pass.
- Pre-push hook (`bun turbo typecheck`) 30/30 on every push.
- Manual surface: isolated `XDG_*`, `OPENCODE_DB`, tool/plugin data dirs,
  tmux socket `oc-footer-qa`, fake OpenAI-compatible provider with a
  `high` variant and a `tool/vtps.ts` plugin tool taking a multi-line prompt:
  - `{}` matches vanilla: `▣  Build · QA Model · 2.9s`.
  - legacy keys (`footer_variant`, `turn_timing`, `timestamps: "user,tool"`,
    `model_label: "id"`) match the pre-change build `bd9676d499` line for
    line: `▣  Build · qa/qa-model · high · 1.0s · 1.8s total`.
  - mixed (`model: false`, `time: "important"`, `duration:
    "assistant,tool"`, `message_id: ["user"]`): `▣  Build · high · 10:59 PM
    · 783ms`, user line `10:59 PM · msg_...`.
  - `all`: `▣  Build · QA Model · high · 12:18 AM · 1.6s · 3.6s total ·
    msg_...`, and vtps inline `⚙ vtps [...three lines...]` then
    `12:18 AM · 1.5s · msg_...` aligned under the text.
  - `/turn-durations` with `footer` unset persisted `turn_timing_duration:
    true` in kv; with `footer.duration` set it left kv untouched.

## Timeline

- 2026-10-07
  [`ses_ee68aab01ffei41gwUGJ5ESj6W`](../sessions/2026-10-07-tui-footer-elements.md)
  - `1ca196f2b2`, `efc7b3db27`, `4c6be131b4`: build, docs, PR #53877;
  installed on desktop and m4max; `footer` set to `"all"` for every key in
  both hosts' `tui.json`.

## Current maintenance notes

- Port to v2 once Vibeterm core runs on v2. Keep PR #53877's branch and body
  current when this feature changes (force-with-lease both remotes).
- Host setting: `"footer"` with all seven keys `"all"` in
  `~/.config/opencode/tui.json` on desktop and m4max; the legacy
  `footer_variant`, `timestamps` and `turn_timing` keys are still present
  there and are overridden.

### Upstream integration checklist

- Confirm `AssistantMessage` still draws its footer from `details()` and every
  tool renderer still passes `part` to `InlineTool`/`BlockTool`.
- Confirm `navigationTargets(..., "landmark")` still exists for `"important"`.
- Run `test/config.test.tsx`, `test/routes/session/navigation.test.ts`,
  `test/cli/tui/inline-tool-wrap-snapshot.test.tsx` and `bun typecheck` in
  `packages/tui`.
- With every key `"all"`, a plugin tool call footers `<time> · <duration> ·
  msg_...`; with `{}` the transcript matches upstream.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
