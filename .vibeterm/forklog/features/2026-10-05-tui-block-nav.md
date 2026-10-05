# Navigate the transcript by block and landmark

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-block-nav` (off upstream `dev` `907b3bc518`; also the upstream PR head)
- First local commit: `79251bcdf3` (cherry-pick of `86036a3af0` on `tui-block-nav`)
- Current local commit(s): `79251bcdf3`
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

## Goals

- `ctrl+home` / `ctrl+end` go to the top / bottom of the transcript; the
  bottom resumes following new output.
- `ctrl+up` / `ctrl+down` step through every block: user prompt, assistant
  text part, reasoning part with content, tool call.
- `ctrl+shift+up` / `ctrl+shift+down` step through landmarks only: user
  prompts, each turn's final response, and `question` / `todowrite` / `task`
  calls.
- Every binding is a default, overridable in `tui.json` under `messages_*`
  names.

## Non-goals

- `messages_next` / `messages_previous` keep their upstream behavior (user
  prompts only, unbound).

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

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
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

## Timeline

- 2026-10-05
  [`ses_ef46f1775ffe29MtElYF4DQySL`](../sessions/2026-10-05-tui-block-nav.md)
  - `79251bcdf3`: introduce; upstream issue #53331 and PR #53333; build and
    install on desktop and m4max.

## Current maintenance notes

- Drop the fork commit once PR #53333 (or an equivalent) is in upstream `dev`.
- No host setting; the bindings are defaults.

### Upstream integration checklist

- Confirm the text, reasoning, inline-tool and block-tool boxes still carry
  `id={part.id}` and user messages `id={message.id}`.
- Run `test/routes/session/navigation.test.ts`, `test/keymap.test.tsx` and
  `bun typecheck` in `packages/tui`.
- Build through `.vibeterm/build.sh`; press `ctrl+up` / `ctrl+shift+up` in a
  long session.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
