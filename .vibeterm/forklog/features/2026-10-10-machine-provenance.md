# Machine provenance on messages and session execution

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `TBD`
- First local commit: `20670c19cd`
- Current local commit(s): `20670c19cd`, `a963ef5224`
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`), per the commit's `AI-Tool` trailer
- Last checked against upstream: `dfb56f76c7` (upstream `v1`, contains `v1.19.0`)
- Upstream: none (fork-only)

## Original request

TBD - not recovered. Authoring session `ses_ede14eb59ffe4qffBGjJtqvQIZ`
(commit trailer of `20670c19cd`); this record was created later from the
commit message and the fork's README section.

## Goals

- When `VIBETERM_MACHINE_ID` is set, new persisted user and assistant
  messages carry an immutable `vibeterm.creator` (machine ID, name, hostname,
  platform, creation time); copies (forks, compaction) keep the original
  creator and remap `objectId`.
- Admitted prompt loops and shell runs record
  `session.metadata.vibeterm.lastExecution`; a fork does not inherit it.
- Without the ID, nothing is stamped.

## Non-goals

- Migrations, triggers or historical backfills; writes on streamed deltas.

## Rationale and constraints

- Vibeterm writes `session.metadata.vibeterm` straight to the row
  (`_lib/vibeterm-session-meta` in opencode-tools), so an engine projection
  carrying a stale copy must not erase it. Only the `vibeterm` subtree is
  merged (`notes` by `updatedAt`, `lastExecution` by `(at, executionId,
  machineId)`); every other metadata key is the engine's and follows the
  event, as upstream, so `PATCH /session/:id` can change or clear it.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `20670c19cd` | 2026-10-10 | creator stamps, `lastExecution`, projection merge | `MachineProvenance.mergeMetadata` / `latest` in `packages/schema/src/machine-provenance.ts`; `Session.Updated`/`Created` projection in `packages/core/src/session/projector.ts`; `createMessage` / `recordExecution` / `fromRow` / `forkMetadata` in `packages/opencode/src/session/session.ts`; `test/session/machine-provenance.test.ts` |
| `a963ef5224` | 2026-10-11 | merge only the `vibeterm` subtree; `recordExecution` keeps the other keys | `mergeMetadata`, `recordExecution`; `test/server/session-actions.test.ts` "expose metadata" |

## Verification

- 2026-10-11 [`ses_ed2434bbbffelX96qcp5XqFLNw`](../sessions/2026-10-11-fork-test-regressions.md):
  `session-actions` "expose metadata" passes at `20670c19cd^`, fails at
  `20670c19cd`, passes with `a963ef5224`; `machine-provenance.test.ts` passes.

## Timeline

- 2026-10-10 `ses_ede14eb59ffe4qffBGjJtqvQIZ` - `20670c19cd`: introduce.
  Evidence: commit trailer; no session record exists.
- 2026-10-11 [`ses_ed5f9f826ffeno6fI51rL96d5Q`](../sessions/2026-10-11-upstream-v1-19.md) -
  rebased onto upstream `v1` `dfb56f76c7` (`v1.19.0`).
- 2026-10-11 [`ses_ed2434bbbffelX96qcp5XqFLNw`](../sessions/2026-10-11-fork-test-regressions.md) -
  `a963ef5224`: a metadata update replaces keys outside `vibeterm` again;
  this record created.

## Current maintenance notes

- Run `test/session/machine-provenance.test.ts` and
  `test/server/session-actions.test.ts` in `packages/opencode` on every bump.

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- Run the two tests above and `bun typecheck` in `packages/schema`,
  `packages/core` and `packages/opencode`.
- Link a new timeline row to the current session record.
- Update `Last checked against upstream`.

## Supersession or removal

- Not applicable; status is active.
