# Send a turn past the composer from a TUI plugin

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `prompt-deliver`
- First local commit: `c1645d7aef`
- Current local commit(s): `c1645d7aef`, `99c057215c`
- Upstream base when introduced: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Last checked against upstream: `006d837c50` (`v1.19.5`)

## Original request

Coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, quoting the user:

> vtps & drafts are safe - i've seen it in action multiple times. but is vtps
> & modal open at a given moment? eg. agent/model selection list, the pasted
> content thingie, etc. we should take care of that too if not done yet. best
> - without even closing those modals, those actions on the prompt field
> should happen in background, without prompt field focus.

## Goals

- A plugin can send the shown session a turn while a dialog (command palette,
  agent or model list, paste editor) is open, without closing it, typing into
  its filter, or touching the composer's draft, caret or focus.
- A delivery whose admission is uncertain can be resent under the same IDs and
  is stored once.
- A delivery reaches a session while opencode's permission or question prompt
  stands in the composer's place, and leaves that prompt on screen with its
  selection, unanswered.

## Non-goals

- Answering, dismissing or reordering a pending permission or question, and
  showing the composer while one is pending. A subagent session, which has no
  composer, still refuses with `unmounted`.
- Shell mode and slash commands: the text is always a plain prompt.

## Rationale and constraints

- `replace()`/`submit()` refuse with reason `dialog` while `dialog.stack` is
  non-empty, which is right for anything that edits the composer. A delivery
  does not need the composer at all: the composer's own `submitInner` only
  reads the agent, model, variant and workspace and hands the prompt to
  admission.
- Measured 2026-10-16 on vt-321 (opencode-tools
  `_lib/vibeterm-tmux/modal-delivery.e2e.test.ts`): deliveries into a tab with
  the palette, agent list, model list or paste editor open were all held until
  the dialog closed.
- A permission or question prompt unmounts the composer, so `deliver()` found
  no prompt ref. The server does not need one: a prompt sent while the turn
  waits on `Permission.ask`/`Question.ask` is stored at once, the pending
  request is untouched, and the turn reads the prompt after the person
  answers (proved in `packages/opencode/test/session/prompt.test.ts`). The
  session route registers `PromptHeld` (`{ disabled }`, the revert-apply
  state) through `PromptRefProvider.hold` while it shows such a prompt, and
  `deliver()` gates on it in place of the missing handoff. `snapshot`, `read`,
  `replace`, `submit` and `seal` still see `unmounted`.
- Admission normally gives a refused prompt back to the composer. A delivery
  is not the person's text, so `Admission.delivery` drops it instead and the
  composer's notice ignores it; the sender retries by ID.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `c1645d7aef` | 2026-10-16 | `api.prompt.deliver({ sessionID, text, messageID?, partID? })`; idempotent per messageID; delivery admissions dropped instead of given back | `packages/plugin/src/tui-prompt.ts` `TuiComposerApi.deliver`; `packages/tui/src/plugin/prompt-control.ts` `deliver`; `packages/tui/src/prompt/deliver.ts` `createPromptSend`; `packages/tui/src/prompt/admission.tsx` `Admission.delivery` |
| `99c057215c` | 2026-11-02 | deliver while a permission or question prompt replaces the composer; the prompt stays unanswered | `packages/tui/src/context/prompt.tsx` `held`/`hold`; `packages/tui/src/routes/session/index.tsx` `promptRef.hold`; `packages/tui/src/plugin/prompt-control.ts` `PromptHeld`, `deliver` gate; `packages/tui/src/plugin/adapters.tsx` `held` |

## Verification

- `bun test test/prompt-control.test.ts test/prompt/admission.test.ts test/prompt-seal.test.ts` (packages/tui) - 53 pass.
- `bun typecheck` (whole monorepo, the pre-push hook) - clean.
- Manual surface, via opencode-tools `modal-delivery.e2e.test.ts` against a
  build of `c1645d7aef`: deliveries with the palette, agent list, model list,
  paste editor and a tmux popup open each became one turn, the dialog stayed
  open with its filter, and the draft was unchanged; a pending permission
  prompt held the delivery and was left unanswered.

- 2026-11-02, `99c057215c`: `bun run test test/prompt-control.test.ts test/routes/session/deliver-past-ask.test.tsx` (packages/tui) - 34 pass; the two app tests fail with `unmounted` with `held` unwired. Server proof: `prompt.test.ts -t "while a (permission|question) is pending"` - 2 pass. Real PTY: opencode-tools `modal-delivery.e2e.test.ts` permission scenario delivers on vt-399 with the prompt still shown, and the turn's next request carries the delivery after Allow once; vt-397 holds it.

## Timeline

- 2026-10-16 [`ses_ed24b7cfbffe5YyKo7piBEsLF6`](../sessions/2026-10-16-tui-prompt-deliver.md) -
  introduced. Evidence: `c1645d7aef`, linked session.
- 2026-11-02 [`ses_e62e4b66dffeHaCeeYFr3mvsZ8`](../sessions/2026-11-02-deliver-past-permission.md) -
  delivers behind a pending permission or question prompt. Evidence: `99c057215c`, linked session.

## Current maintenance notes

- Scheduled delivery identity: branch `preserve-hook-profile`, session `ses_eac9def85ffeQUlw8vmM8s7aoY`, moves session profile persistence to the final user-message save boundary after `chat.message` hooks. A delivery ticket can change the message's agent/model/variant after picker resolution; storing the pre-hook values made the actual turn and the session's next inherited profile disagree. Ordinary agent/model default resolution is unchanged. The focused regression is `persists the final user profile after message hooks override it` in `packages/opencode/test/session/prompt.test.ts`.

- `createPromptSend` mirrors the normal-prompt branch of
  `component/prompt/index.tsx` `submitInner`; an upstream change to how that
  builds its `session.prompt` body must be carried into `deliver.ts`.

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- Classify the customization as preserved, conflicted, superseded, or removed.
- Run the feature's focused tests and affected package typechecks.
- Build through the host's canonical installer and verify the installed binary.
- Link a new timeline row to the current session record.
- Update `Last checked against upstream`.
