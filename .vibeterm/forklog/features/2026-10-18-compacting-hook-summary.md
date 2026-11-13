# Let the compacting hook project the prior summary

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `compacting-hook-seams` (worktree `.vibeterm/worktrees/compacting-hook-seams`); `compaction-stream-boundary` (worktree `.vibeterm/worktrees/compaction-stream-boundary`)
- First local commit: `e160264623`
- Current local commit(s): `e160264623`; `deb9f05a51` plus its natural-completion gate follow-up on `compaction-stream-boundary`, both carrying `AI-Session-ID: ses_e6b90f99fffennKWXq3VoePII2`
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
- `output.stopSequences?: string[]` starts as `[]` and bounds model summary publication locally, without provider request options or provider-specific strings.

## Non-goals

- No-policy summaries and ordinary continuation behavior remain unchanged; a local boundary finalizes accepted narrative through the existing completion hook.
- V2 compaction remains a separate customization: [awaited v2 compaction summary completion](./2026-11-11-v2-compaction-summary.md).
- An upstream PR.

## Rationale and constraints

- The retention plugin shrinks the prior summary before the summarizer sees it; the summary bypassed `experimental.chat.messages.transform`.
- `retainedMessages` lists only what the code keeps after a successful compaction: the tail past the summarized head when the compaction part records `tail_start_id`, the overflow replay for an auto or resumed compaction, and the queued prompts moved behind the summary. The plugin must still treat a failed compaction as retaining nothing.
- `rawText` (a user message's non-synthetic, non-ignored text parts joined by blank lines) lets the plugin match its ledger's raw prompt bodies; `text` keeps the serializer's `[User]: ` framing.
- `conversationModel` is resolved from the model the continuation uses (`continueAs`) and is absent rather than guessed when it cannot be resolved; the summarizer `model` can differ from it.
- `experimental.session.compacting` is not part of the HTTP API, so no SDK or client regeneration.
- The boundary matcher holds only the longest possible suffix prefix (at most max sequence length minus one), handles delta splits and newline-prefixed boundaries at output start, and flushes unmatched suffixes at natural text-end. Empty sequences are rejected.
- A match ends the provider-scoped consumer before the completion hook, without interrupting the processor or draining trailing events in the same chunk. Hook failure and empty accepted narrative fail compaction and preserve source history.
- Completion-hook failures at natural text-end are excluded before provider retry classification too, whether boundaries are enabled or disabled. The original error is carried through failure handling unchanged; a later plugin cannot trigger regeneration after an earlier plugin consumed its retention snapshot. `retry.ts` is unchanged.
- Received usage stays intact; no finish-step is synthesized. Text-part `metadata.localStop` and the `local stream stop` log record `{ reason: "stop-sequence", sequenceIndex, finalUsage: "unavailable" }` without rejected text or sequence contents.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `e160264623` | 2026-10-18 | hook input/output fields; `continueAs` resolved before the hook | `SessionCompaction.process` `experimental.session.compacting` trigger and `buildPrompt` call (`packages/opencode/src/session/compaction.ts`), `Hooks["experimental.session.compacting"]` and `CompactionModel` (`packages/plugin/src/index.ts`), `plugins.mdx` "Compaction hooks" |
| `deb9f05a51` | 2026-10-31 | optional hook output `stopSequences`, bounded text matcher, scoped stream stop, shared text finalization, honest missing-usage accounting | `text-stop.ts`, `SessionProcessor.create` and policy consumer, compacting hook output and processor input, `plugins.mdx` |
| Natural-completion gate follow-up carrying `ses_e6b90f99fffennKWXq3VoePII2` | 2026-10-31 | exclude completion-hook failures before provider retry classification and preserve original API errors | `SessionProcessor.finishText`, pre-retry cause handling, `compaction-completion.test.ts` |

## Verification

- `bun run test test/session/compaction.test.ts` in `packages/opencode` - 62 pass, 0 fail (first run). New tests: default prompt equals `buildPrompt` with the stored summary (no hooks); hook input carries the summary and both models and the prompt stays byte-identical when untouched; a returned `previousSummary` replaces the prompt's prior summary while stored summaries stay `["summary one", "summary two"]`; `retainedMessages` lists the retained tail with `role`, `text` and `rawText`.
- `bun typecheck` in `packages/opencode` and `packages/plugin` - clean.
- Stream-boundary coverage: `text-stop.test.ts` has 49 passing cases for every split position, output start, EOF, overlapping prefixes, empty rejection and literal inline prose. `compaction-stop.test.ts` and `compaction-stop-http.test.ts` have 10 passing cases covering actual published deltas, one completion/append, provider scope closure, retained usage, no synthetic finish-step, failure preserving history and retryable completion failure without provider retry.
- Real HTTP evidence: a hanging loopback SSE server observes both request abort and response cancellation while the completion hook is awaiting acknowledgement, on AI SDK and native runtimes. Each test asserts one request, successful `Compacted`, safe-only publications, completed summary, and no error/retry.
- Final combined run: `bun run test test/session/text-stop.test.ts test/session/compaction-stop.test.ts test/session/compaction-stop-http.test.ts test/session/processor-effect.test.ts test/session/compaction.test.ts` - 138 pass, 1 skip, 0 fail, 571 assertions. One earlier combined run interrupted the existing pending-tool cleanup test; that case passed alone and the full rerun passed. `bun typecheck` in both packages exits 0; editor diagnostics repeatedly timed out across the assigned worktree, so no fresh editor-diagnostic claim is made.
- Gate regression: all four `compaction-completion.test.ts` cases first failed because a one-shot retryable natural-end completion error caused two provider requests. After the fix, 14 integrated tests pass with 157 assertions across that file and the two stop suites. Cases cover failure before append and after retention consumes its snapshot, with boundaries enabled and disabled; each asserts one request, failed summary, original API error fields, visible source history, no `Compacted`, no continuation and no retry status. Both package typechecks exit 0; fresh diagnostics for the processor and new/modified test files are clean in this follow-up.
- Gate broad validation: two seven-suite runs hit `ENOSPC` in test-fixture directory creation. A subsequent alternate-scratch run wedged and was deliberately interrupted by the parent, which explicitly took ownership of final broad validation and installation. No broad-pass claim is made for this follow-up.

## Timeline

- 2026-11-13 [W13 session](../sessions/2026-11-13-v2-compaction-summary.md) adds the v2 counterpart with an awaited textual completion stage, generation/cutoff identities, prior-summary projection and pre-publication stop filtering. This is v2 delivery; no v1 source or v1 re-verification is claimed.
- 2026-10-18 [`ses_eac9cdf26ffeEPtXV2TXi0WMOu`](../sessions/2026-10-18-fork-hook-seams.md) - initial build; field names agreed with `ses_ebc8f2bc4ffehcETvBMsNJHPhX` and `ses_eacab0c1cffepx2161EwKEzyOO`. Evidence: tests above.
- 2026-10-31 [`ses_e6b90f99fffennKWXq3VoePII2`](../sessions/2026-10-18-fork-hook-seams.md#stream-boundary-follow-up) - root streaming boundary fix delegated by `ses_e6b9f5c6effeX2U71zc5tix97F`; branch-only delivery, no merge, push, install or live-session changes.

## Current maintenance notes

- Consumer: the retention plugin built by `ses_eacab0c1cffepx2161EwKEzyOO`.
- The byte-identical tests reconstruct the default prompt with core `buildPrompt`; if upstream changes the prompt shape, they follow it.
- The policy consumer calls `handleEvent` inside `Stream.takeUntilEffect`, not in an upstream `tap` that can process an entire chunk before testing the boundary. Installed Effect beta.83's `runForEachWhile` incorrectly flips per-chunk continuation; the real HTTP tests cover multi-chunk consumption and prevent using it here.

### Upstream integration checklist

- Locate the `experimental.session.compacting` trigger in `SessionCompaction.process`; keep `buildPrompt` reading `compacting.previousSummary`.
- Run `test/session/compaction.test.ts`, `processor-effect.test.ts`, `text-stop.test.ts`, `compaction-stop.test.ts`, `compaction-stop-http.test.ts`, `compaction-completion.test.ts`, and `bun typecheck` in `packages/opencode` and `packages/plugin`.
- Link a new timeline row to the current session record.
