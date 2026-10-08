# v1 database guard gate in the fork build

## Identity

- Workday: 2026-10-08
- Session: `ses_ee2d6b316ffeQ4Lr6J5QvW225u`
- Agent/platform: `Sisyphus` / `linux`
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `feat/v2-migration-guard-gate`
- Upstream base: `907b3bc518` (contains `v1.18.34`)
- Source result commit(s): `d17ac9a02a`
- Forklog commit: this file's introducing commit

## User requests

> our system-provided opencode version update checker and main-nowaker bumper
> should be instructed to take special care here, and always ensure the poison
> pill stays in place and continues to work.

## Goals

- No fork build installs without the v1 database guard gate passing.

## Constraints and non-goals

- No rebuild or install of opencode in this session.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| fork | `dev-nowaker` | `6df3e29294` | this record's commit | fast-forward |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [v1 database guard gate before install](../features/2026-10-08-v1-db-guard-gate.md) | added | gate PASSED, missing-guard refusal |

## Other delivered work

- opencode-tools: `_lib/v2-migration-guard` (guard, collector step, daily
  gate job, doctor row, `vibeterm-v2-guard`).

## Verification

- See the feature record's Verification section.

## Build and install

- Build command: not run.
- Installed artifact: not installed.
- Running services: not applicable.

## Commit provenance

- `d17ac9a02a` - the gate in `.vibeterm/build.sh`
- Required trailer: `AI-Session-ID: ses_ee2d6b316ffeQ4Lr6J5QvW225u`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-08-v1-db-guard-gate.md
```

## Unknowns and blocked verification

- A full `.vibeterm/build.sh` run through the gate was not done (no rebuild
  was needed); the gate function was exercised alone.
