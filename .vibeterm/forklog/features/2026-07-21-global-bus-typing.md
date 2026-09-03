# Strict global bus typing

## Identity

- Status: active
- Integration branch: `master-nowaker`
- Development branch(es): direct work on `master-nowaker`
- First local commit: `1c1c90344`
- Current local commit(s): `1c1c90344`
- Upstream base when introduced: `a85d8d23aa` (`v1.18.5`)
- Last checked against upstream: `f12e14cf1` (`v1.18.27`)

## Original request

TBD - no surviving original prompt specific to this standalone type fix was
found. The session's final report records the published strict-global-bus fix.

## Goals

- Preserve the global bus's actual event contract under newer Node event type
  definitions.
- Keep ID assignment before listeners receive an event.

## Non-goals

- Do not narrow or override the built-in `EventEmitter.emit` signature.

## Rationale and constraints

- Newer Node definitions accept built-in listener events and arbitrary names,
  so a narrowed subclass override is incompatible with the base class.
- Composition keeps the public wrapper strict without violating the runtime
  emitter's type contract.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `1c1c90344` | 2026-07-21 | Wrap `EventEmitter` instead of narrowing its override | `GlobalBusEmitter` in `bus/global.ts` |

## Verification

- 2026-08-29 `packages/opencode` typecheck exits 0.
- The semantic custom-seam diff still contains only the expected wrapper and
  event-ID assignment behavior against `v1.18.25`.

## Timeline

- 2026-07-21 `ses_151d2dd79ffeEX3zcZ4QxoVsGF` - publish the standalone
  strict global event-typing fix. Confirmed by the final transcript's exact
  `bus: preserve strict global event typing` report and matching HEAD commit
  `1c1c90344`. CWD: `~/projekty/nowaker/opencode-tools`; platform: OpenCode;
  development branch: `master-nowaker`.
- 2026-08-29
  [`ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](../sessions/2026-08-29-upstream-bump-and-forklog.md)
  - preserve strict wrapper typing and event-ID ordering through `v1.18.25`.
  Evidence: `packages/opencode` typecheck exits 0.
- 2026-09-02
  [`ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](../sessions/2026-09-02-opencode-omo-refresh.md)
  - preserve strict wrapper typing and event-ID ordering through `v1.18.27`.
  Evidence: `packages/opencode` typecheck exits 0.

## Current maintenance notes

- Preserve the wrapper if Node's `EventEmitter` types change again.
- Keep ID assignment ahead of the wrapped emitter call.

## Supersession or removal

- Not applicable; status is active.
