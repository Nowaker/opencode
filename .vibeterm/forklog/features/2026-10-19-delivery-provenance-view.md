# Expandable delivery provenance on user messages

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-provenance` (fork worktree `.vibeterm/worktrees/tui-provenance`)
- First local commit: `ad24b3b1e2`
- Current local commit(s): `ad24b3b1e2`
- Upstream base when introduced: `dfb56f76c7` (upstream `v1`, contains `v1.19.0`), fork tip `0a6d075e52`
- Last checked against upstream: `dfb56f76c7`
- Upstream: fork-only, no upstream PR.

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` from `ses_ebc8f2bc4ffehcETvBMsNJHPhX` (token overhead report, `opencode-tools tmp/vibeterm-token-overhead.pdf`):

> TUI: a user message whose text part carries metadata.vibeterm.provenance shows the compact block as today, plus an expandable view of the FULL record, every field. Expand and collapse with a click and with a key, and offer a copy of the full record. It should fit the fork's existing expand/collapse and click conventions [...] Rows without the metadata render exactly as before.

## Goals

- The model keeps reading only the compact `[vibeterm_metadata]` block in `TextPart.text`; the full record rides on `TextPart.metadata.vibeterm = { schema: 1, provenance: { block, entries, displayText? } }`.
- A prompt with a valid record shows `▸ Delivery provenance · N fields · Click to expand`; expanded, the full text and a Fields view of every entry.
- Click the row, `<leader>p` / `/provenance` (session-wide), or Message Actions Expand/Collapse/Copy provenance.
- Vibeterm delivers through the TUI composer, not HTTP: `TuiComposerDeliverRequest.metadata` (plain JSON object) is stored on the delivered text part, advertised by `TuiComposerApi.deliveryMetadata: true`.
- A record shows only while `provenance.modelText === part.text`, so an edited prompt never shows a stale record.

## Non-goals

- Producers (projection, `chat.message`, question answer bodies), compaction retention and the shell env belong to other owners.
- No new column, part type or schema change; no SDK regeneration.

## Rationale and constraints

- The TUI cannot import opencode-tools at runtime, so `packages/tui/src/util/vibeterm-provenance.ts` mirrors `opencode-tools _lib/vibeterm-provenance/index.ts` exactly and is checked against that codec's `fixtures/tui-fork.json`, copied verbatim to `packages/tui/test/fixture/vibeterm-provenance.json`.
- Strict reader: schema must be `1`; the block must parse; entries are validated deeply and must equal the block's own parse; an invalid `displayText` rejects the record. Anything else renders exactly as before.
- Full text needs an exact offset-0 compact block in `part.text`; otherwise the original text is kept, so stale metadata cannot replace an edited message.
- Delivery needed no change: `TextPartInput.metadata` already exists and `prompt` stores parts by spread. v1 `toModelMessages` sends only `{ type, text }` for user text parts.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `ad24b3b1e2` | 2026-10-19 | Reader, view, toggle command, dialog actions, docs | `packages/tui/src/util/vibeterm-provenance.ts`, `packages/tui/src/routes/session/provenance.tsx`, `session.toggle.provenance`, `session_toggle_provenance`, `message.provenance.*` |
| `ad24b3b1e2` | 2026-10-19 | Composer `deliver()` metadata: validation, copy, replay fingerprint, capability flag | `TuiComposerDeliverRequest.metadata`, `TuiComposerApi.deliveryMetadata`, `createPromptControl`, `createPromptSend` |
| `ad24b3b1e2` | 2026-10-19 | No-model-leak serializer test | `packages/opencode/test/session/message-v2.test.ts` "never sends user text part metadata" |

## Verification

- `bun run test test/util/vibeterm-provenance.test.ts` (packages/tui) - 14 pass, 8 codec fixtures included.
- `bun run test test/routes/session/provenance.test.tsx` (packages/tui) - 3 pass.
- `bun run test test/session/message-v2.test.ts` (packages/opencode) - 42 pass.
- `bun run test` (packages/tui) - 837 pass, 1 skip, 0 fail.
- `bun typecheck` in packages/tui and packages/opencode - clean.
- `bun run test test/prompt-control.test.ts test/prompt/deliver.test.ts` (packages/tui) - deliver metadata, refusal, replay and flag cases pass.
- Manual surface (composer): a scratch TUI plugin called `api.prompt.deliver` with codec fixture metadata; the server stored it on the text part, the row rendered and expanded; replay returned the first receipt, changed metadata and an array were refused `invalid`.
- Manual surface: scratch `opencode serve` + seed via prompt API `noReply` + `attach` on tmux socket `provrig`; collapsed row, `ctrl+x p`, SGR mouse click (no Message Actions), dialog Expand provenance, `/provenance`, Copy provenance captured via OSC 52 as the exact full text, plain message unchanged.

## Timeline

- 2026-10-19 [`ses_eaca3043cffex00KfTm0HE9UJr`](../sessions/2026-10-19-delivery-provenance-view.md) - initial build. Evidence: linked session.

## Current maintenance notes

- When the opencode-tools codec changes, mirror it and re-copy `fixtures/tui-fork.json`; the parity test is the contract.
- An upstream bump must re-check that v1 `toModelMessages` still drops user text part metadata.
