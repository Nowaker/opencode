# Navigate the transcript by prompt, landmark and block

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-block-nav` (off upstream `dev` `907b3bc518`; also the upstream PR head, amended to `fdba5ac828` on 2026-10-06)
- First local commit: `79251bcdf3` (cherry-pick of `86036a3af0` on `tui-block-nav`)
- Current local commit(s): `79251bcdf3`, `50b9d3b329`
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `907b3bc518` (upstream `dev`)
- Upstream: issue [#53331](https://github.com/anomalyco/opencode/issues/53331), PR [#53333](https://github.com/anomalyco/opencode/pull/53333)

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, quoting the user:

> introduce new shortcuts: ctrl+end ctrl+home, that scroll you to the very top
> of scrollback, or to the end. ctrl+up/down navigate to previous/next ai/user
> interaction, e.g. tool call, message, thinking block etc. (for gpt that only
> have Thinking / Thought block - jump over those, they're useless),
> ctrl+shift+up/down - same but only between user prompts, final ai responses,
> and special tool calls (questions, todos, i guess these are the only ones
> worth navigating to? you find and decide)

2026-10-06 relayed key layout, quoting the user:

> ctrl+up/down prompt, ctrl+shift+up/down important blocks,
> ctrl+alt+shift+up/down any block. which means new feature, modify existing
> pr if not accepted yet.

## Goals

- `ctrl+home` / `ctrl+end` go to the top / bottom of the transcript; the
  bottom resumes following new output.
- `ctrl+up` / `ctrl+down` (`messages_previous` / `messages_next`) step
  through every user prompt.
- `ctrl+alt+shift+up` / `ctrl+alt+shift+down` (`messages_block_*`) step
  through every block: user prompt, assistant text part, reasoning part with
  content, tool call.
- `ctrl+shift+up` / `ctrl+shift+down` step through landmarks only: user
  prompts, each turn's final response, and `question` / `todowrite` / `task`
  calls.
- Every binding is a default, overridable in `tui.json` under `messages_*`
  names.

## Non-goals

- None recorded.

## Rationale and constraints

- Upstream `dev` binds `messages_first` / `messages_last` to `ctrl+g,home` /
  `ctrl+alt+g,end` and leaves `messages_next` / `messages_previous` unbound.
  Only user messages carried a renderable `id`, so assistant parts could not
  be matched to scrollbox children.
- Reasoning whose text is empty after stripping `[REDACTED]` (GPT's
  "Thinking" placeholders, encrypted blocks) renders as a bare `Thought` line
  and is skipped, by the same test `ReasoningPart` uses.
- Landmark tools are `question`, `todowrite` and `task`. Edits, patches,
  reads and shell calls make up most of a turn, so stopping on them would make
  landmarks the same as blocks.
- A navigated block lands one row below the viewport top, as `messages_next`
  already does. "Next" and "previous" are relative to that anchor, so repeated
  presses walk one block at a time. `keepScrollAnchor` reacts only to
  `layout-changed`, so it doesn't fight the `scrollBy` that navigation does.
- Vibeterm's tmux passes `C-Up`/`C-Down` through in the root table (they are
  bound only after the prefix and in copy mode), and binds `C-S-Up`/`C-S-Down`
  in the root table to `send-keys C-S-Up/Down` for every non-navbar pane. With
  `extended-keys on`, opentui receives all six keys.
- Vanilla `messages_previous` / `messages_next` skipped any prompt within 10
  rows of the viewport top (fixed `±10` threshold) and scrolled a page when no
  prompt was left. Since 2026-10-06 they use the shared picker with a
  `prompt` scope, so every prompt is a stop.
- Vibeterm's tmux binds `C-M-Up`/`C-M-Down` only in `copy-mode` and nothing
  on `C-M-S-Up`/`C-M-S-Down`, so `ctrl+alt+shift+up/down` pass through;
  opentui parses `\e[1;8A` as ctrl+shift with `meta`/`option` set, which the
  `ctrl+alt+shift+up` binding matches.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `50b9d3b329` | 2026-10-06 | `ctrl+up`/`ctrl+down` bound to prompt navigation through the shared picker; block navigation moved to `ctrl+alt+shift+up`/`down` | `messages_previous` / `messages_next` / `messages_block_*` defaults in `packages/tui/src/config/keybind.ts`; `"prompt"` scope in `navigationTargets`; `scrollToBlock("prompt", ...)` for `session.message.next` / `.previous` |
| `79251bcdf3` | 2026-10-05 | block and landmark navigation, `ctrl+home`/`ctrl+end` on first/last | `messages_block_*` / `messages_landmark_*` in `packages/tui/src/config/keybind.ts`; `navigationTargets` / `pickNavigationTarget` in `packages/tui/src/routes/session/navigation.ts`; `scrollToBlock` and commands `session.block.*` / `session.landmark.*` in `packages/tui/src/routes/session/index.tsx`; `id={part.id}` on the `TextPart`, `ReasoningPart`, `InlineToolRow` and `BlockTool` boxes; `keybinds.mdx` defaults |

## Verification

- `bun typecheck` and `bun test` in `packages/tui` on `dev-nowaker`:
  244 pass, 0 fail. `test/routes/session/navigation.test.ts` covers block and
  landmark selection and target picking.
- Manual surface: isolated `XDG_*`, throwaway tmux socket `oc-tui-nav` with
  `extended-keys on`, imported 24-message session (6 turns, each with an empty
  GPT-style reasoning placeholder, reasoning with content, text, `edit`, `bash`,
  `todowrite`, alternating `question`/`task`, and a multi-paragraph final
  response). `C-Up` walks bash, edit, text, reasoning (the placeholder is
  skipped), then the prompt; `C-S-Up` walks todos, prompt, previous final,
  question; `C-Home` / `C-End` reach top and bottom; a prompt draft is left
  untouched. On vanilla `907b3bc518` none of those keys moved the viewport.
- 2026-10-06 (`ses_ef46f1775ffe29MtElYF4DQySL`): `bun test` 255 pass in
  `packages/tui` on `dev-nowaker`; tmux QA with the hosts' `tui.json`
  keybind overrides (`messages_previous: ctrl+up`, `messages_next:
  ctrl+down`, `messages_first: ctrl+g,ctrl+home`, `messages_last:
  ctrl+alt+g,ctrl+end`) and a 28-message session with two one-line turns:
  `C-Up` stops on `SHORT B` and `SHORT A`, which the installed
  `1.18.34-vt-116` build skipped; `C-M-S-Up` walks blocks; `C-S-Up` walks
  landmarks. Repeated on the installed `1.18.34-vt-118` build.

## Timeline

- 2026-10-07
  [`ses_ee68aab01ffei41gwUGJ5ESj6W`](../sessions/2026-10-07-tui-footer-elements.md)
  - `1ca196f2b2`: `isLandmark` in `navigation.ts` lets `footer` values of `"important"` reuse the landmark targets; tested in `navigation.test.ts`.

- 2026-10-06 [`ses_eeda1d251ffel81U5Y42j4kb33`](../sessions/fork-audit.md) -
  verify target helpers and real navigation keys; retained-history/exact-tool
  landmark limits are in the linked inventory.

- 2026-10-05
  [`ses_ef46f1775ffe29MtElYF4DQySL`](../sessions/2026-10-05-tui-block-nav.md)
  - `79251bcdf3`: introduce; upstream issue #53331 and PR #53333; build and
    install on desktop and m4max.
- 2026-10-06
  [`ses_ef46f1775ffe29MtElYF4DQySL`](../sessions/2026-10-06-tui-nav-layout.md)
  - `50b9d3b329`: prompt navigation on `ctrl+up`/`ctrl+down`, blocks on
    `ctrl+alt+shift+up`/`down`; PR #53333 amended to `fdba5ac828`; build and
    install on desktop and m4max.
- 2026-10-09
  [`ses_ef46f1775ffe29MtElYF4DQySL`](../sessions/2026-10-09-editor-home-end.md)
  - `680e8a0daa`: `ctrl+home` / `ctrl+end` no longer reach `messages_first` /
    `messages_last` by default; those are `ctrl+g,ctrl+alt+home` /
    `ctrl+alt+g,ctrl+alt+end` (editor-standard scheme).

## Current maintenance notes

- Drop the fork commit once PR #53333 (or an equivalent) is in upstream `dev`.
- No host setting needed. Both hosts' `tui.json` override `messages_previous`
  / `messages_next` / `messages_first` / `messages_last` with values equal to
  or compatible with the defaults; no block or landmark override.

### Upstream integration checklist

- Confirm the text, reasoning, inline-tool and block-tool boxes still carry
  `id={part.id}` and user messages `id={message.id}`.
- Run `test/routes/session/navigation.test.ts`, `test/keymap.test.tsx` and
  `bun typecheck` in `packages/tui`.
- Build through `.vibeterm/build.sh`; press `ctrl+up`, `ctrl+shift+up` and
  `ctrl+alt+shift+up` in a long session.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
