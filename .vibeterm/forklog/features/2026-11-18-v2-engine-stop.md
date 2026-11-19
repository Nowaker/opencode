# Native v2 engine stop: seal admission for idle stop and restart

## Identity

- Status: active (W24 landed and installed on desktop; W24b, the remaining owners, is gated and not landed)
- Integration branch: `v2-nowaker` (source); `dev-nowaker` (this record)
- Development branch(es): `engine-stop-seal` (W24), `engine-stop-w24b` (W24b, uncommitted)
- First local commit: `2f2c119414`
- Current local commit(s): `2f2c119414`
- Upstream base when introduced: `v2.2.7` (`fedc6f208a`); fork tip before W24 `235c6a4b6e`
- Last checked against upstream: `v2.2.7`

## Original request

TBD - the coordinator's W24 assignment is not in this session's retained history. The contract is `engine-stop-contract.txt` (sha256 `4e8b1e56`) in the W1 scratch directory; its §2 "W24 scope split" defines what W24 fences and what W24b owns.

## Goals

- Vibeterm can stop an engine only when no work is starting or running (idle), or restart it after interrupting owned work (force), without a fresh admission slipping past the seal.

## Non-goals

- No automatic stop, TTL, retry or new listener. W24 itself does not enable Stage 2 idle stop; that waits for W24b.

## Rationale and constraints

- `EngineStop` is one process-local gate with work claims, an activity revision and one prepare/cancel operation, under `/api/experimental/server/stop` (`client.experimental.server.stop.{get,prepare,cancel}`). Idle prepare compares the revision and seals only with zero claims; force-restart installs the same barrier first, interrupts owned executions with the shutdown reason and seals once they settle.
- Fenced owners take a claim before their first durable effect and are refused with `EngineStopRefusedError` (HTTP 503) under a seal.
- The commit message of `2f2c119414` leaves out three points that are part of the landed state: the endpoints are `ServerStopEndpoints` added to `ExperimentalGroup` (no deprecated aliases), with handlers from `makeServerStop` in `handlers/server-stop.ts` wired into the `server.experimental` group (`handlers/server.ts` unchanged); the server engine-stop test follows the contract's §7 `waitMs` rule (long-polls prepare with `waitMs: 10_000`); the schema contract test builds its expected values with the schema's brand constructors.
- Stage 2 requirement: an idle prepare in the window between a settled-execution event and that execution's claim release returns `work-active` (retryable); Stage 2 must treat `work-active` within one settle of an idle observation as retry-later.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `2f2c119414` | 2026-11-18 | engine-stop gate, claims, idle and force prepare, owner fences listed in its message | `packages/core/src/engine-stop.ts`, `engine-stop/{claims,control,state}.ts`; `claims.within` on owners; `SessionRunCoordinator` claim and successor transfer; `ServerStopEndpoints` in `protocol/src/groups/server.ts` |

## Verification

- Gates packet `w24/packet.json` v8 (`48e0d45a`), run by W15 on desktop 2026-11-19: 28 rows green, including the per-package schema typecheck added after v7 stopped on 3 TS2769 errors, 11 mutants red as named, Core suites 971/0, client 264/0, turbo 34/34.
- Desktop install: `opencode2` `v2.2.7-vt-50-5f76acb125`, sha256 `1d8cef6b...`, build packet `w24-build/packet.json` (`95e5cd26`), probe 12/0/0, protected identities unchanged, vt-46 archived as `opencode2.prev-1795067500` (verified by the coordinator 2026-11-19T05:53Z).
- The first build run (`966c4646`) failed the probe's plugins-per-location check. The cause was the probe fixture's `fs.watchFile` gate, fixed in opencode-tools `07452e75e0` (see the session record). Diagnostic numbers: on the old gate vt-46 passed 3/3 and the W24 build vt-50 failed 2/3; on the event gate vt-50 passed 3/3 and vt-46 1/1. 3 runs is not proof of absence of an engine race.

## Timeline

- 2026-11-18 [`ses_e3832b1b0ffe6q98OeUzhgqhjQ`](../sessions/2026-11-18-v2-engine-stop.md) - W24 landed, desktop install, probe fixture fix; W24b source prepared.

## Current maintenance notes

- Not yet fenced until W24b lands: command dispatch and its transfer to owned work, direct generate, move, native schedule arming/firing/leadership and the native-schedule-armed idle veto, subagent completion delivery. Stage 2 idle stop stays off until then.
- m4max install deferred while it travels.
