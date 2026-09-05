# Message shape normalization

## Identity

- Status: active
- Integration branch: `master-nowaker`
- Development branch(es): direct work on `master-nowaker`
- First local commit: `af19b7db7`
- Current local commit(s): `af19b7db7`
- Upstream base when introduced: `a85d8d23aa` (`v1.18.5`)
- Last checked against upstream: `f12e14cf1` (`v1.18.27`)

## Original request

TBD - no surviving original prompt found. The recovered session title is:

> Profiling unresponsive OpenCode

## Goals

- Keep hydrated message and part objects shape-stable across optional fields.
- Prevent structure proliferation from driving JavaScriptCore megamorphic
  property access and garbage-collection pressure.
- Reuse unchanged hydrated rows through bounded caches.

## Non-goals

- Do not change persisted message or part schemas.

## Rationale and constraints

- Spreading variable JSON objects produced tens of thousands of JavaScriptCore
  Structures in long retained sessions.
- Explicit discriminator-specific key lists keep one stable shape per message
  role and part type.
- Caches are bounded at 200,000 info rows and 400,000 part rows.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `af19b7db7` | 2026-05-23 | Normalize hydrated objects and add bounded caches | `MessageV2.info()`, `MessageV2.part()` |

## Verification

- The introducing commit reports production CPU falling from 99-115% to about
  13% and anonymous memory falling from 4 GB to 796 MB on the same workload.
- Its deterministic 5,000-message benchmark reduced info Structures from 47 to
  2 and part Structures from 16 to 5.
- 2026-08-29 semantic gate: message-v2, pagination, and compaction coverage is
  green inside 388 pass / 3 skip / 0 fail.

## Timeline

- 2026-05-23 `ses_1abc831d9ffeWO4PJ6S3qtd6I9` - diagnose the OpenCode GC
  death spiral and stabilize hydrated MessageV2 shapes. Confirmed by the
  session title, exact `GC death spiral` and MessageV2 investigation evidence,
  and commit `af19b7db7`. CWD: `~/projekty/nowaker/opencode-tools`; platform:
  OpenCode; development branch: `master-nowaker`.
- 2026-08-29
  [`ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](../sessions/2026-08-29-upstream-bump-and-forklog.md)
  - preserve normalized message shapes and bounded caches through `v1.18.25`.
  Evidence: the message, pagination, and compaction gate is green.
- 2026-09-02
  [`ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](../sessions/2026-09-02-opencode-omo-refresh.md)
  - preserve normalized shapes and bounded caches through `v1.18.27`.
  Evidence: message, pagination, and compaction coverage passes.
- 2026-09-04
  [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-04-opencode-omo-refresh.md)
  - preserve normalized shapes and bounded caches through `v1.18.28`.
  Evidence: the 3596-test package suite passes.

## Current maintenance notes

- Preserve explicit fixed property lists when upstream adds optional fields.
- Keep `message-v2-shape-stability-perf.test.ts` in the semantic bump gate.

## Supersession or removal

- Not applicable; status is active.
