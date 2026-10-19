# Let the compacting hook project the prior summary

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `compacting-hook-seams` (worktree `.vibeterm/worktrees/compacting-hook-seams`)
- First local commit: `e160264623`
- Current local commit(s): `e160264623`
- Upstream base when introduced: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Last checked against upstream: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Upstream PR: none (fork-only by request)

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` for `ses_ebc8f2bc4ffehcETvBMsNJHPhX` and its retention worker `ses_eacab0c1cffepx2161EwKEzyOO`:

> packages/opencode/src/session/compaction.ts (around :402): previousSummary goes into the compaction prompt and bypasses experimental.chat.messages.transform, so a plugin cannot project it.

> Extend the EXISTING `experimental.session.compacting` hook, additively

## Goals

- `experimental.session.compacting` input carries `previousSummary`, the summarizing `model`, the continuation `conversationModel`, and `retainedMessages` (`{ id, role, text, rawText? }`).
- `output.previousSummary` starts as the input value; the default compaction prompt anchors to whatever the hook leaves there.
- No hook, or a hook that leaves the output untouched, sends a byte-identical prompt.

## Non-goals

- The persisted summary message and the ordinary continuation are unchanged.
- v2 compaction (`packages/core/src/session/compaction.ts`), which has no plugin hook.
- An upstream PR.

## Rationale and constraints

- The retention plugin shrinks the prior summary before the summarizer sees it; the summary bypassed `experimental.chat.messages.transform`.
- `retainedMessages` lists only what the code keeps after a successful compaction: the tail past the summarized head when the compaction part records `tail_start_id`, the overflow replay for an auto or resumed compaction, and the queued prompts moved behind the summary. The plugin must still treat a failed compaction as retaining nothing.
- `rawText` (a user message's non-synthetic, non-ignored text parts joined by blank lines) lets the plugin match its ledger's raw prompt bodies; `text` keeps the serializer's `[User]: ` framing.
- `conversationModel` is resolved from the model the continuation uses (`continueAs`) and is absent rather than guessed when it cannot be resolved; the summarizer `model` can differ from it.
- `experimental.session.compacting` is not part of the HTTP API, so no SDK or client regeneration.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `e160264623` | 2026-10-18 | hook input/output fields; `continueAs` resolved before the hook | `SessionCompaction.process` `experimental.session.compacting` trigger and `buildPrompt` call (`packages/opencode/src/session/compaction.ts`), `Hooks["experimental.session.compacting"]` and `CompactionModel` (`packages/plugin/src/index.ts`), `plugins.mdx` "Compaction hooks" |

## Verification

- `bun run test test/session/compaction.test.ts` in `packages/opencode` - 62 pass, 0 fail (first run). New tests: default prompt equals `buildPrompt` with the stored summary (no hooks); hook input carries the summary and both models and the prompt stays byte-identical when untouched; a returned `previousSummary` replaces the prompt's prior summary while stored summaries stay `["summary one", "summary two"]`; `retainedMessages` lists the retained tail with `role`, `text` and `rawText`.
- `bun typecheck` in `packages/opencode` and `packages/plugin` - clean.

## Timeline

- 2026-10-18 [`ses_eac9cdf26ffeEPtXV2TXi0WMOu`](../sessions/2026-10-18-fork-hook-seams.md) - initial build; field names agreed with `ses_ebc8f2bc4ffehcETvBMsNJHPhX` and `ses_eacab0c1cffepx2161EwKEzyOO`. Evidence: tests above.

## Current maintenance notes

- Consumer: the retention plugin built by `ses_eacab0c1cffepx2161EwKEzyOO`.
- The byte-identical tests reconstruct the default prompt with core `buildPrompt`; if upstream changes the prompt shape, they follow it.

### Upstream integration checklist

- Locate the `experimental.session.compacting` trigger in `SessionCompaction.process`; keep `buildPrompt` reading `compacting.previousSummary`.
- Run `test/session/compaction.test.ts` and `bun typecheck` in `packages/opencode` and `packages/plugin`.
- Link a new timeline row to the current session record.
