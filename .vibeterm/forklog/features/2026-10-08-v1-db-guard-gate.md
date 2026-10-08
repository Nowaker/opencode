# v1 database guard gate before install

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `feat/v2-migration-guard-gate`
- First local commit: `d17ac9a02a`
- Current local commit(s): `d17ac9a02a`
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `907b3bc518` (upstream `dev`, contains `v1.18.34`)

## Original request

From coordinator `ses_ef8235798ffejGr4sa22eXmVNv`'s brief, quoting the user:

> our system-provided opencode version update checker and main-nowaker bumper
> should be instructed to take special care here, and always ensure the poison
> pill stays in place and continues to work.

## Goals

- `.vibeterm/build.sh` installs nothing unless opencode-tools'
  `vibeterm-v2-guard gate --v1 <built>` passes: the built binary and npm's
  newest `opencode-ai` 1.x each create a blank v1 database, the guard is added,
  npm's newest `@opencode/cli` fails on it naming the guard with the logical
  dump unchanged, and the v1 binary still serves it.

## Non-goals

- The guard itself (trigger `_vt_refuse_v2_migration`, column
  `event.created`) lives in opencode-tools `_lib/v2-migration-guard`, not in
  the fork's source.

## Rationale and constraints

- A vanilla v2 server migrates the default v1 database in place at startup;
  our v1 fork then exits at startup. A bump that changes v1's migrations, or a
  v2 release that stops recording migrations or adding `event.created`, could
  defeat the guard silently.
- Locating the guard command: `VIBETERM_V2_GUARD`, which the collector's fork
  updater (`_lib/opencode-upstream/step.ts` `buildOpencodeFork`) sets, else
  `vibeterm-v2-guard` on PATH. `OPENCODE_SKIP_V2_GUARD_GATE=1` is for a host
  without opencode-tools, never for a failing gate.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `d17ac9a02a` | 2026-10-08 | `v2_guard_gate` between locating `$BUILT` and the inode swap | `.vibeterm/build.sh` `v2_guard_gate` |

## Verification

- `v2_guard_gate` sourced alone with `BUILT=<installed 1.18.34-vt-177>` and
  `VIBETERM_V2_GUARD` set - gate PASSED: 2 v1 checks and 6 v2 runs against
  `@opencode/cli@2.0.26` and `opencode-ai@1.18.35`; returned 0.
- Same with no guard on PATH - names the missing command, returns 1.
- `bash -n .vibeterm/build.sh` - ok; `--help` shows the new paragraph.

## Timeline

- 2026-10-08 [`ses_ee2d6b316ffeQ4Lr6J5QvW225u`](../sessions/2026-10-08-v1-db-guard-gate.md) -
  initial gate. Evidence: `d17ac9a02a`.

## Current maintenance notes

- A failing gate during a bump means the guard needs a new poison in
  opencode-tools, not a skipped gate.

### Upstream integration checklist

- The build installs through the gate; a red gate blocks the bump until
  `_lib/v2-migration-guard` is fixed and the gate passes.
