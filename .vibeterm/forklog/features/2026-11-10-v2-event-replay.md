# Durable v2 events and authenticated replay

## Identity and request

- Status: active. Source integration: `v2-nowaker`; forklog integration: `dev-nowaker`.
- Upstream base: `v2.2.7` (`fedc6f208a`), fork base `d90d41a907`.
- Source commits: `691b33c0b3` (persistence); `1f6d9fb8c1` (replay).

> events.persist on for our serve/stdio modes

> POST /api/experimental/event/replay

## Behavior and stable seams

- `packages/cli/src/server-process.ts`: enable `events.persist` when launching fork servers. `OPENCODE_EVENTS_PERSIST=0` restores upstream sequence-only storage; `1` and `true` explicitly enable it.
- `packages/protocol/src/groups/event.ts`: `POST /api/experimental/event/replay`, identifier `experimental.event.replay`, in the existing experimental group and behind the server's ordinary authentication.
- Request: `{ event: { id, type, created?, seq, aggregateID, data }, ownerID?, strictOwner?, publish? }`. `strictOwner` and `publish` default to `true`.
- `packages/server/src/handlers/event-replay.ts`: validate the serialized envelope and registered durable payload, then invoke the receiving process's `Bus.replay`. Success is HTTP 204, invalid input is 400, and replay divergence or strict-owner mismatch is 409.
- `packages/client` generation exposes the route on both clients. Generated files are rebuilt through `bun run generate`.
- Exact retries retain their original sequence and do not republish. Both peers must persist events. Project/workspace prerequisites must already exist; imported or forked history still needs a transfer baseline. This patch does not implement the replicator or writer handoff.

## Verification

- CLI persistence suite: 3 pass, 0 fail. Removing the persistence option gives 1 pass, 2 fail: both normal and stdio servers lose their durable payloads while the disabled control still passes.
- Replay HTTP suite: 11 pass, 0 fail, 49 assertions. It covers exact retries, strict owner fencing, ID/data/sequence gaps, reused IDs, invalid envelopes/payloads and existing authentication.
- Replacing the replay call with a no-op gives 5 pass, 6 fail; restoring the owner returns 11 pass.
- Experimental path/identifier contract: 1 pass, 0 fail. Canonical `bun run check` passes all 34 workspace typechecks, with the same 550 pre-existing lint warnings and 0 errors. A second final client generation is a no-op.
- Installed dual-engine proof: `.vibeterm/tmp/opencode/w4-proof-aJTJ4D/result.json`, `opencode v2.2.7-vt-8-5f76acb125`. All 7 scenarios pass; 19 contiguous events applied twice leave 19 rows and 6 matching messages on the receiver, and in-process replay reaches the live SSE subscription.
- The later metadata delivery's desktop vt-9 canonical gate passes all 12 rows, including persisted replay reaching native SSE and an attached TUI, exact retry 204 and wrong owner 409. The metadata probe additionally replays 73 complete metadata events into a differing baseline. Evidence is linked from the shared W4 session record.

## Upstreamability

- Replay endpoint: upstreamable; it exposes existing event-sourcing behavior through the established authenticated experimental API.
- Persistence wiring: upstream-shaped and suitable for an opt-in; this fork's enabled-by-default policy is a deliberate local choice.
- No upstream PR was opened.

## Timeline

- 2026-11-10 [W4 session record](../sessions/2026-11-10-v2-patches.md), [source session](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e37e57935ffeTjd0whAV8iFPzQ): retain durable events and expose in-process replay for Phase 0 proofs.
