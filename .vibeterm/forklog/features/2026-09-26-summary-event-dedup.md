# Unchanged message summary event suppression

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch: `summary-event-dedup`
- First local commit: `927891b095f18c8de8f17ce2c181ec45166196bd`
- Current integration commit: `ff79c7b333`
- Upstream base when introduced and last checked: `b471c2b449`

## Original request

Coordinator relayed the user's choice:

> Fix the emitter only

## Goals and non-goals

- Avoid publishing the full user message when recomputed summary diffs equal
  the existing diffs, including oversized snapshots.
- Preserve all diff fields, meaningful changes, replay contracts, and history.
- No pruning, database cleanup, global event deduplication, or version upgrade.

## Rationale and changes

`SessionSummary.summarize` runs from prompt-start and processor completion.
`Session.updateMessage` publishes a full durable message snapshot, whose
projector upserts the message while event storage appends another row.
The producer compares diffs with `isDeepStrictEqual` before mutation and
publication. Missing diffs and an empty array remain different states.

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `927891b095` / `ff79c7b333` | 2026-09-26 | Skip unchanged summary writes | `packages/opencode/src/session/summary.ts`: `SessionSummary.summarize` |

## Verification

- Real Git snapshots and isolated database: eight sequential repeats plus four
  concurrent calls against already-current diffs append no message events.
- Content-only changes with equal line counts, reversions, and clearing diffs
  still append events. Existing rows and projected message data are preserved.
- Installed CLI: eight model turns via a local fake provider produced two
  distinct 1,200,495-byte user summary events, each occurring once.
- Commands and build identity are in the linked session record.

## Timeline

- 2026-09-26 [ses_f1f9b9b74ffe8xPPTsmvM4op8M](../sessions/2026-09-26-summary-event-dedup.md)
  - Initial implementation, integration, and desktop installed-binary proof.

## Maintenance and limits

- Re-run `test/session/summary-events.test.ts` and
  `test/session/snapshot-tool-race.test.ts` from `packages/opencode`.
- This is not atomic deduplication: two computations that both load old state
  may still publish identical new summaries. Existing stale-computation races
  are not addressed. Do not add locks/CAS or global ordering changes implicitly.
- Event history is consumed by sync/replay; do not remove historical events as
  part of maintaining this guard.
