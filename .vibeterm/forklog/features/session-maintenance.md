# Session replacement maintenance

## Purpose and seams

- Optional identity replacement needs targeted write exclusion while unrelated
  sessions continue. Mapped-copy sync is a separate tools policy.
- `packages/core/src/database/session-maintenance.ts` installs persistent fences,
  immutable process-generation snapshots, and runtime capability registration.
- `session-maintenance-conflict.ts` guards implicit SQLite REPLACE deletions with
  independent indexed lookups for each rowid/unique key and its index collation.
- `session-maintenance-trigger.ts` replaces obsolete same-name conflict guards
  atomically only when their canonical definitions differ.
- `session-maintenance-write.ts` permits fresh instrumented writers through
  retired identity barriers; stale runtime generations remain rejected.

## Safety contract

- Protocol 3 requires the indexed conflict guards. Protocol 2 had scanning OR
  predicates and is not the repaired capability.
- An adjacent `<database>.conflict-guards-disabled` marker keeps emergency
  protocol 0, ordinary guards, inert same-name persistent conflict guards, and
  no conflict TEMP guards. Marker removal is an explicit coordinator operation.
- Existing connections retain their TEMP guards until refreshed. Installation
  of a binary alone does not upgrade their capability.
- Unknown expression or partial unique indexes fail closed during installation.
- Tests cover REPLACE, UPDATE collisions, composite NOCASE/RTRIM keys, migration
  rollback/idempotence, emergency activation, and unrelated-session writes.
- A 500,000-row fixture executes 195 update / 134 insert VM steps with both
  empty and active fence/generation sets. Plan tests forbid `SCAN existing`.

## Timeline

- [Implementation and phase-1 distribution](../sessions/session-maintenance.md):
  original fence commits, independently identified performance regression,
  emergency override, indexed repair, and isolated verification.
