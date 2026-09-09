# Global memory diagnostics

## Identity

- Status: active
- Integration branch: `master-nowaker`
- Development branch(es): `TBD - not recoverable from the surviving record`
- First local commit: `20a24f2eb`
- Current local commit(s): `20a24f2eb`
- Upstream base when introduced: `a85d8d23aa` (`v1.18.5`)
- Last checked against upstream: `5cd8e68fd` (upstream `dev`, post-`v1.18.29`)

## Original request

TBD - no surviving original prompt found. The strongest surviving transcript
evidence names `GET /global/memory` directly.

## Goals

- Expose process and JavaScriptCore memory counters without taking a heap
  snapshot.
- Make native-memory growth distinguishable from JavaScript heap growth.

## Non-goals

- No mutation, authentication, or heap-snapshot creation.

## Rationale and constraints

- A large gap between process RSS and JavaScript heap size points to native or
  off-heap retention, which a JavaScript heap snapshot cannot explain.
- The route is read-only and follows the existing open global-health posture.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `20a24f2eb` | 2026-05-13 | Add `GET /global/memory` | `GlobalMemoryStats`, `GlobalMemoryRoute`, `global.ts` |

The response combines `process.memoryUsage()`, `bun:jsc.heapStats()`, and
`bun:jsc.memoryUsage()` with an ISO capture timestamp.

## Verification

- Historical commit records a live JSON response shape with process, JSC heap,
  JSC memory, and object-type counters.
- 2026-08-29 semantic gate: `httpapi-global.test.ts` and the surrounding custom
  seam suite pass as part of 388 pass / 3 skip / 0 fail.

## Timeline

- 2026-05-13 `ses_229d7083fffem6lkaEj69adZ7H` - add the global memory
  diagnostic route. Inferred from the exact `GET /global/memory` transcript
  match, the session span, and commit date; no exact commit command survived.
  CWD: `/home/nowaker/projekty/ai-workspace`; platform: OpenCode.
- 2026-08-29
  [`ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](../sessions/2026-08-29-upstream-bump-and-forklog.md)
  - preserve the route through the `v1.18.25` integration and re-run its
  semantic gate. Evidence: 388 pass / 3 skip / 0 fail.
- 2026-09-02
  [`ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](../sessions/2026-09-02-opencode-omo-refresh.md)
  - preserve the route through the `v1.18.27` integration. Evidence: global
  HTTP API coverage passes in the 339-test focused gate.
- 2026-09-04
  [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-04-opencode-omo-refresh.md)
  - preserve the route through `v1.18.28`. Evidence: the 3596-test package
  suite and `packages/opencode` typecheck pass.

- 2026-09-08
  [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-08-opencode-dev-omo-refresh.md)
  - preserve the route through upstream dev `5cd8e68fd`. Evidence:
  `packages/opencode` typecheck exits 0.

## Current maintenance notes

- Preserve the route when upstream changes global `HttpApi` composition.
- Regenerate the JavaScript SDK after its public response schema changes.

## Supersession or removal

- Not applicable; status is active.
