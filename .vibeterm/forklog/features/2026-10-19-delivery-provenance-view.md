# Expandable delivery provenance on user messages

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-provenance` (fork worktree `.vibeterm/worktrees/tui-provenance`); `vt-section` (2026-10-22 redesign)
- First local commit: `ad24b3b1e2`
- Current local commit(s): `ad24b3b1e2`, `6df5f316a7` (Vibeterm section redesign)
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
- Since 2026-10-22: a prompt starting with `[vibeterm_metadata]` blocks is one box in two stacked parts, no gap. The top Vibeterm section shows the blocks' fields with the tag lines hidden, under a bar in tui.json `vibeterm_color` (default ANSI 13, Vibeterm's brand color); the bottom part is the body under the agent color. Each part hovers and takes clicks on its own; a click anywhere in the Vibeterm section expands the stored record and never opens Message Actions; a right click copies the blocks. Several leading blocks fold into one section; a block without a usable record still gets the section, with nothing to expand. The old bottom `▸ Delivery provenance` row is gone.

## Redesign request (2026-10-22)

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, the user's words condensed by the coordinator:

> i don't like it's on the bottom, not very visible, the original vt metadata is still on the top. and if i misclick one row up/down from the delivery provenance link, i get the revert window. [...] vt metadata block is the first element. it is formatted like user prompt (the box with left side color) - and the color will not be the agent's color, it will be vibeterm's brand color [...] there is no space between the vt-styled box and the agent-styled box immediately below. [...] onmouseover on agent-styled section doesn't highlight the vt-section. [vibeterm_metadata] not shown anymore. click expands full version of it.

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
| `6df5f316a7` | 2026-10-22 | Split Vibeterm section and agent section, per-section hover and click, right-click copy, `vibeterm_color` (theme `vibeterm()` resolves an ANSI number through the detected terminal palette) | `splitVibetermHead`, `vibetermHead`, `VibetermSection` (`routes/session/provenance.tsx`), `UserMessage`, `TuiConfig.VibetermColor`, `useTheme().vibeterm` |
| `ad24b3b1e2` | 2026-10-19 | No-model-leak serializer test | `packages/opencode/test/session/message-v2.test.ts` "never sends user text part metadata" |

## Verification

- `bun run test test/util/vibeterm-provenance.test.ts` (packages/tui) - 14 pass, 8 codec fixtures included.
- `bun run test test/routes/session/provenance.test.tsx` (packages/tui) - 3 pass.
- `bun run test test/session/message-v2.test.ts` (packages/opencode) - 42 pass.
- `bun run test` (packages/tui) - 837 pass, 1 skip, 0 fail.
- `bun typecheck` in packages/tui and packages/opencode - clean.
- `bun run test test/prompt-control.test.ts test/prompt/deliver.test.ts` (packages/tui) - deliver metadata, refusal, replay and flag cases pass.
- Manual surface (composer): a scratch TUI plugin called `api.prompt.deliver` with codec fixture metadata; the server stored it on the text part, the row rendered and expanded; replay returned the first receipt, changed metadata and an array were refused `invalid`.
- 2026-10-22: `bun run test test/util/vibeterm-provenance.test.ts test/routes/session/provenance.test.tsx` (packages/tui) - 26 pass, codec fixture parity included; full `bun run test` (packages/tui) - 856 pass, 1 skip, 0 fail; `bun typecheck` (packages/tui) clean.
- 2026-10-22 manual surface: scratch `serve` + `attach` on tmux socket `vtsec`, seeded with a recorded delivery, a two-block delivery without a record, and a plain prompt. SGR clicks on a field row, the section's top and bottom padding rows (one above the agent part), and the record-less section opened no Message Actions; the padding clicks toggled the record; a body click opened Message Actions with Expand/Copy provenance. Hover: SGR moves over each part changed only that part's background (233 to 234). `ctrl+x p` expanded every field; right click copied the full block (OSC 52 tmux buffer) with a `Copied Vibeterm metadata` toast. Bars: Vibeterm section `38;5;13`, agent part its agent color.
- Manual surface: scratch `opencode serve` + seed via prompt API `noReply` + `attach` on tmux socket `provrig`; collapsed row, `ctrl+x p`, SGR mouse click (no Message Actions), dialog Expand provenance, `/provenance`, Copy provenance captured via OSC 52 as the exact full text, plain message unchanged.

## Timeline

- 2026-10-19 [`ses_eaca3043cffex00KfTm0HE9UJr`](../sessions/2026-10-19-delivery-provenance-view.md) - initial build. Evidence: linked session.
- 2026-10-22 [`ses_eaca3043cffex00KfTm0HE9UJr`](../sessions/2026-10-22-vibeterm-section.md) - redesign into a split Vibeterm section with `vibeterm_color`. Evidence: `6df5f316a7`, linked session.

## Current maintenance notes

- When the opencode-tools codec changes, mirror it and re-copy `fixtures/tui-fork.json`; the parity test is the contract.
- An upstream bump must re-check that v1 `toModelMessages` still drops user text part metadata.
- `splitVibetermHead` is fork-only and sits outside the codec mirror; the parity test does not cover it.
- `vibeterm_color`'s Vibeterm default follows opencode-tools `sidebar.brandColor` (opencode-tools `1483d7b3e73`); the opencode default stays ANSI 13 to match.
