# Sync hot-path tuning

## Identity

- Status: active
- Integration branch: `dev-nowaker` (`master-nowaker` until 2026-09-22)
- Development branch(es): `master-nowaker` (inferred)
- First local commit: `ad228a28a`
- Current local commit(s): `ad228a28a`
- Upstream base when introduced: `a85d8d23aa` (`v1.18.5`)
- Last checked against upstream: `2406400f0` (upstream `dev`, contains `v1.18.32`)

## Original request

TBD - no surviving original prompt found. Transcript searches recover the
`event aggregate_id`, sync-indexing, and compression workstream.

## Goals

- Reduce CPU and query cost on event replay and HTTP sync responses.
- Prefer throughput over maximum compression ratio on the sync hot path.

## Non-goals

- Do not change the sync wire contract.

## Rationale and constraints

- Event replay repeatedly filters by aggregate identity.
- Compression CPU was more expensive than the additional bytes at the observed
  sync workload.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `ad228a28a` | 2026-05-29 | Tune sync replay and use compression level 1 | `handlers/sync.ts`, `middleware/compression.ts` |

The commit also carries `test/perf/bench-fce.ts` for the replay hot path. The
event aggregate index is generated through the repository's schema path rather
than maintained as a handwritten runtime query.

## Verification

- 2026-08-29 semantic gate: HTTP sync and compression tests pass inside
  388 pass / 3 skip / 0 fail.

## Timeline

- 2026-05-29 `ses_18d75fa67ffeMRJOuGsqmrqq9h` - index aggregate replay and
  tune sync compression. Inferred from same-day transcript matches for
  `event aggregate_id`, sync indexing, and compression; no exact commit command
  survived. CWD: `~/projekty/nowaker/opencode-tools`; platform: OpenCode;
  development branch: `master-nowaker` (inferred).
- 2026-08-29
  [`ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](../sessions/2026-08-29-upstream-bump-and-forklog.md)
  - preserve indexed replay and level-1 compression through `v1.18.25`.
  Evidence: HTTP sync and compression tests pass in the semantic gate.
- 2026-09-02
  [`ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](../sessions/2026-09-02-opencode-omo-refresh.md)
  - preserve indexed replay and level-1 compression through `v1.18.27`.
  Evidence: sync and compression coverage passes in the focused gate.
- 2026-09-04
  [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-04-opencode-omo-refresh.md)
  - preserve indexed replay and level-1 compression through `v1.18.28`.
  Evidence: the 3596-test package suite passes.

- 2026-09-08
  [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-08-opencode-dev-omo-refresh.md)
  - preserve indexed replay and level-1 compression through upstream dev
  `5cd8e68fd`. Evidence: `packages/opencode` typecheck exits 0.
- 2026-09-22 [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-22-dev-nowaker-rebuild.md) -
  replayed unchanged onto upstream `dev` `2406400f0` as `dev-nowaker`; tree equals
  the `master-nowaker` + `dev` merge tree. Evidence: that session's gates.

## Current maintenance notes

- Preserve level-1 compression when upstream refactors middleware options.
- Keep the event aggregate lookup indexed after schema or migration changes.

## Supersession or removal

- Not applicable; status is active.
