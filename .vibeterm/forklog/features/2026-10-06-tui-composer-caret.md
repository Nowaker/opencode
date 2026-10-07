# Read and place the composer caret from a TUI plugin

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `composer-caret` (worktree
  `/home/nowaker/projekty/webapps/opencode/.vibeterm/worktrees/composer-caret`)
- First local commit: `bba3ccfe3b`
- Current local commit(s): `bba3ccfe3b`
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `907b3bc518` (upstream `dev`, contains `v1.18.34`)

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 16 of its
"opencode TUI improvements" effort), quoting the user:

> recovery of drafts saved on sessions (is this opencode fork change, or vt
> plugin?) - also remember where the caret/block cursor is when in the prompt
> field, so when i'm typing a prompt and i'm HERE ^ content above, and content
> below me, the 'one off vtss' one - if i get interrupted, my prompt comes back
> to where i was exactly, and not at the end. default: on.

## Goals

- A TUI plugin can read where the composer's caret and selection are, and put
  them back when it restores a draft, so vibeterm's draft keeper brings an
  interrupted prompt back with the caret where it was.

## Non-goals

- OpenCode persists nothing. Saving, restoring and the `drafts.restoreCaret`
  setting stay in `opencode-tools` (route plugin draft keeper, session loader).
- No upstream PR: this extends the fork-only composer API of
  [TUI composer read](./2026-09-27-tui-composer-read.md); upstream has no
  plugin composer API to extend.

## Rationale and constraints

- `api.prompt.read()` returned text and parts only, and `replace()` always left
  the caret at the end of the text (`PromptRef.set` calls `gotoBufferEnd`).
- The edit buffer counts its caret in terminal cells: a wide glyph or a tab is
  several offsets. Plugins hold `input` as a string, so the caret crosses the
  API as UTF-16 offsets, converted through `getTextRange` both ways (measured:
  cell offsets inside a wide glyph map to the same text prefix).
- A caret move does not advance the handoff `revision`, so the keeper keys its
  writes on `caret` as well. A read is cached per revision and cell position,
  because the keeper polls it every 200ms.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `bba3ccfe3b` | 2026-10-06 | `read().caret` (`{ offset, selection? }` or null); `replace({ caret })` places it after the write; a replay with a different caret is a conflict; handoff `caret()`/`place()` | `packages/plugin/src/tui-prompt.ts` `TuiComposerCaret`, `TuiComposerDraft.caret`; `packages/plugin/src/tui.ts` `TuiPromptRef.handoff`; `packages/tui/src/component/prompt/index.tsx` `readCaret`/`placeCaret`; `packages/tui/src/plugin/prompt-control.ts`; `packages/tui/test/prompt-control.test.ts` |

## Verification

- `bun test test/prompt-control.test.ts` (packages/tui) - 23 pass.
- `bun test test/cli/tui/plugin-composer.test.ts` (packages/opencode) - 1 pass.
- `bun typecheck` in packages/tui, packages/plugin and packages/opencode - clean.
- Manual surface, via `opencode-tools`
  `opencode-vibeterm-route-plugin/native-drafts.e2e.test.ts` against a build of
  this commit: a session tab and a sessionless tab each hold a typed line, a
  pasted block and a tail whose caret sits between two wide glyphs. After
  `kill -9` of each OpenCode, and again after the tmux server dies and the
  layout is restored, a key typed into each restored composer lands between the
  glyphs. Against the previously installed `1.18.34-vt-128-907b3bc518` the same
  key landed at the end of the text.

## Timeline

- 2026-10-06 [`ses_eec44ad14ffeownfvFKtEeqk4N`](../sessions/2026-10-06-tui-composer-caret.md) -
  introduced, built and installed on desktop and m4max. Evidence: `bba3ccfe3b`,
  linked session.

## Current maintenance notes

- Builds on [TUI composer read](./2026-09-27-tui-composer-read.md); an upstream
  bump must keep `PromptRef.handoff` and the textarea's `cursorOffset`,
  `getSelection`, `setSelection` and `getTextRange`.

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
