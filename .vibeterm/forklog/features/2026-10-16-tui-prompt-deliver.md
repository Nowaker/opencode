# Send a turn past the composer from a TUI plugin

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `prompt-deliver`
- First local commit: `c1645d7aef`
- Current local commit(s): `c1645d7aef`
- Upstream base when introduced: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Last checked against upstream: `dfb56f76c7`

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

## Non-goals

- Delivering while a permission or question prompt replaces the composer: the
  composer could not submit there either, so `deliver()` refuses (`hidden` /
  `unmounted`) and the caller holds the delivery.
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
- Admission normally gives a refused prompt back to the composer. A delivery
  is not the person's text, so `Admission.delivery` drops it instead and the
  composer's notice ignores it; the sender retries by ID.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `c1645d7aef` | 2026-10-16 | `api.prompt.deliver({ sessionID, text, messageID?, partID? })`; idempotent per messageID; delivery admissions dropped instead of given back | `packages/plugin/src/tui-prompt.ts` `TuiComposerApi.deliver`; `packages/tui/src/plugin/prompt-control.ts` `deliver`; `packages/tui/src/prompt/deliver.ts` `createPromptSend`; `packages/tui/src/prompt/admission.tsx` `Admission.delivery` |

## Verification

- `bun test test/prompt-control.test.ts test/prompt/admission.test.ts test/prompt-seal.test.ts` (packages/tui) - 53 pass.
- `bun typecheck` (whole monorepo, the pre-push hook) - clean.
- Manual surface, via opencode-tools `modal-delivery.e2e.test.ts` against a
  build of `c1645d7aef`: deliveries with the palette, agent list, model list,
  paste editor and a tmux popup open each became one turn, the dialog stayed
  open with its filter, and the draft was unchanged; a pending permission
  prompt held the delivery and was left unanswered.

## Timeline

- 2026-10-16 [`ses_ed24b7cfbffe5YyKo7piBEsLF6`](../sessions/2026-10-16-tui-prompt-deliver.md) -
  introduced. Evidence: `c1645d7aef`, linked session.

## Current maintenance notes

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
