# Awaited v2 compaction summary completion

## Identity

- Status: active
- Source integration branch: `v2-nowaker`; forklog tracked on `dev-nowaker`.
- Development branch: `compaction-summary`.
- Source commit: `17d20080b1d287604eedfa405c4fa02b28069967`.
- Base: `45a7c497966461ae3d7bba19192fb794095f9227`, on the fork's pinned v2.2.7 line.

## Original request

> Add an AWAITED compaction-summary completion stage for plugins:

## Behavior and stable seams

- `packages/plugin/src/session-compaction.ts` defines the shared preparation descriptor and `experimental.compaction.summary` payload for both plugin SDKs.
- Preparation exposes an attempt `generationID`, actual foreground `messageID` when available, inclusive source cutoff, replaced IDs, exact retained text/IDs, conversation model and native-window flag. Mutable `previousSummary`, `metadata` and `stopSequences` support snapshot preparation.
- `packages/core/src/session/compaction.ts` awaits textual completion before `Compaction.Ended`, carrying frozen preparation metadata through generation or speculative adoption. Completion receives the actual durable marker and generating model. `native.messages` replacement windows bypass plaintext completion; ordinary native metadata does not.
- `compaction-stop.ts` holds partial boundary prefixes before deltas, suppresses matched boundaries and drains final usage. Empty stopped narratives fail.
- Prior-summary edits survive shrinking; untouched checkpoints rejoin their original provider prefix. Primary-request lowering remains unchanged.
- Manual interruption records usage before cleanup; `session/runner/llm.ts` only supplies fallback failure settlement for a marker still running.
- `ctx.app.capabilities.compactionSummary` and `/api/info` advertise the contract. Client types are generated from Protocol.

## Verification

- Focused compaction/native/transport/runner run: 124 pass, 0 fail, 859 assertions across seven files. Five targeted cases fail with completion/stop/projection disabled. Native-metadata bypass and interrupted usage regressions failed before correction; the cross-model case fails with two generations before the adoption correction.
- Core, Plugin, Protocol, Server and Client package typechecks pass. Changed-file lint reports zero warnings/errors. Client regeneration after rebasing is a no-op.
- Read-only source review accepted the corrected API, failure accounting and untouched-prefix recombination.
- Native desktop build installs `opencode v2.2.7-vt-17-5f76acb125` after the mandatory gate passes 12/12 with no failures/skips. The installed summary-plugin proof verifies awaiting, stable marker identity, frozen record append, stop filtering and rejected-callback usage. Controller demonstration is recorded in the [session record](../sessions/2026-11-13-v2-compaction-summary.md).

## Timeline

- 2026-11-13 [W13 session](../sessions/2026-11-13-v2-compaction-summary.md), [source conversation](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e353f4451ffeLxU5ojxVo28GCb): implementation resumed after the November 11 memory pause; reviewed source published to both mirrors and installed on desktop through the 12/12 gate.

## Maintenance

- Recheck compaction preparation, speculative adoption, textual completion, stream filtering and manual interruption when upstream changes those paths. Regenerate clients from `packages/client` after Protocol changes.
- Upstreamability: generic additive experimental API, suitable for upstream; no upstream PR requested or opened.
- The native `session_message` ledger source adapter and production retention plugin port are W10-owned. Stage support alone does not establish complete retention parity.
