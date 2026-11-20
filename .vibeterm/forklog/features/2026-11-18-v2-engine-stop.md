# Native v2 engine stop: seal admission for idle stop and restart

## Identity

- Status: active (W24, W24b and W28 landed on `v2-nowaker`; desktop `opencode2` is `v2.2.7-vt-52-5f76acb125` with the capability verified from the installed executable)
- Integration branch: `v2-nowaker` (source); `dev-nowaker` (this record)
- Development branch(es): `engine-stop-seal` (W24), `engine-stop-w24b` (W24b), `engine-stop-capability` (W28)
- First local commit: `2f2c119414`
- Current local commit(s): `2f2c119414`, `fbf2fbe0fd`, `f16dced8fc`
- Upstream base when introduced: `v2.2.7` (`fedc6f208a`); fork tip before W24 `235c6a4b6e`
- Last checked against upstream: `v2.2.7`

## Original request

TBD - the coordinator's W24 assignment is not in this session's retained history. The contract is `engine-stop-contract.txt` (sha256 `4e8b1e56`) in the W1 scratch directory; its §2 "W24 scope split" defines what W24 fences and what W24b owns.

## Goals

- Vibeterm can stop an engine only when no work is starting or running (idle), or restart it after interrupting owned work (force), without a fresh admission slipping past the seal.

## Non-goals

- No automatic stop, TTL, retry or new listener. W24, W24b and W28 supply the engine contract; Vibeterm's Stage 2 activation is separate and requires coordinator verification and W15's validation.

## Rationale and constraints

- `EngineStop` is one process-local gate with work claims, an activity revision and one prepare/cancel operation, under `/api/experimental/server/stop` (`client.experimental.server.stop.{get,prepare,cancel}`). Idle prepare compares the revision and seals only with zero claims; force-restart installs the same barrier first, interrupts owned executions with the shutdown reason and seals once they settle.
- Fenced owners take a claim before their first durable effect and are refused with `EngineStopRefusedError` (HTTP 503) under a seal.
- Vibeterm requires literal `true` at `GET /api/info`'s `capabilities.engineStop` before using native idle stop or restart. W24 declared the capability but did not advertise it; W28 (`f16dced8fc`) corrects the info handler. The seal and its routes already existed in vt-51, but Vibeterm correctly refuses to use them without the advertisement.
- The commit message of `2f2c119414` leaves out three points that are part of the landed state: the endpoints are `ServerStopEndpoints` added to `ExperimentalGroup` (no deprecated aliases), with handlers from `makeServerStop` in `handlers/server-stop.ts` wired into the `server.experimental` group (`handlers/server.ts` unchanged); the server engine-stop test follows the contract's §7 `waitMs` rule (long-polls prepare with `waitMs: 10_000`); the schema contract test builds its expected values with the schema's brand constructors.
- Stage 2 requirement: an idle prepare in the window between a settled-execution event and that execution's claim release returns `work-active` (retryable); Stage 2 must treat `work-active` within one settle of an idle observation as retry-later.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `2f2c119414` | 2026-11-18 | engine-stop gate, claims, idle and force prepare, owner fences listed in its message | `packages/core/src/engine-stop.ts`, `engine-stop/{claims,control,state}.ts`; `claims.within` on owners; `SessionRunCoordinator` claim and successor transfer; `ServerStopEndpoints` in `protocol/src/groups/server.ts` |
| `fbf2fbe0fd` | 2026-11-18 | W24b: fences command dispatch (outer claim before location activation; a refusal after dispatch is `Command.ExecutionError`, never not-admitted), background child transfer (`Job.StartInput.claim`), direct generation, move (lock wait stays interruptible), subagent completion delivery (refused delivery stays owed, unacknowledged) and native schedules (lease in `schedule/ownership.ts`, idle probe only for the actual lease holder, sealed scheduler parks on `EngineStop.awaitOpen`); internal plugins require `EngineStop` | `Session.command`, `Command.execute`, `SessionGenerate.generate`, `SessionMove.move`, `SubagentCompletion.deliver`/`deliverGroup`, `schedule/ownership.ts`, `PluginInternal.requirements` |

## Verification

- W28 desktop install: `opencode2` `v2.2.7-vt-52-5f76acb125`, SHA-256 `73ee338364580a6c2cb5c2dd98093f13b2a290d2751974dd97916f8242deda6e`. All 13 candidate probes passed with no skips. A separate authenticated scratch engine launched from the installed path advertised `capabilities.engineStop: true` and returned `open` with zero claims. The vt-51 archive retained its original inode and hash; see the [W28 receipt](../sessions/2026-11-19-v2-engine-stop-capability.md#build-and-install).
- Gates packet `w24/packet.json` v8 (`48e0d45a`), run by W15 on desktop 2026-11-19: 28 rows green, including the per-package schema typecheck added after v7 stopped on 3 TS2769 errors, 11 mutants red as named, Core suites 971/0, client 264/0, turbo 34/34.
- Desktop install: `opencode2` `v2.2.7-vt-50-5f76acb125`, sha256 `1d8cef6b...`, build packet `w24-build/packet.json` (`95e5cd26`), probe 12/0/0, protected identities unchanged, vt-46 archived as `opencode2.prev-1795067500` (verified by the coordinator 2026-11-19T05:53Z).
- W24b gates packet `w24b/packet.json` v3 (`54992dd5`), result `w15-w24b-3.result.json` (sha256 `4e83a4044a3697c1`), 33/33 rows: new Core cases 21/0, server dispatch 1/0, thirteen single-fence mutants each red by its named assertion (each with a same-graph positive control where it adds an observer), suites 64/0, 134/0, 396/0, 278/0, 9/0, protocol 14/0, client 264/0, turbo 34/34. v1 (`679aded9`) stopped on four test defects and v2 (`850c9f20`) on a mutant the test could not tell from an inner fence; neither was a source defect. Since v3 every mutant red is observed in a diagnostic before a packet freezes.
- W24b desktop install: `opencode2` `v2.2.7-vt-51-5f76acb125`, sha256 `f68bf347...`, build packet `w24b-build/packet.json` (`bd5a96de`), gate slice io 0.00 in `vibeterm-jobs.slice`, probe 12/0/0, protected identities unchanged, vt-50 archived as `opencode2.prev-1795098677` (2026-11-19T14:31Z). The first launch (14:10Z) was refused by its gate before building; see the maintenance notes.
- The first build run (`966c4646`) failed the probe's plugins-per-location check. The cause was the probe fixture's `fs.watchFile` gate, fixed in opencode-tools `07452e75e0` (see the session record). Diagnostic numbers: on the old gate vt-46 passed 3/3 and the W24 build vt-50 failed 2/3; on the event gate vt-50 passed 3/3 and vt-46 1/1. 3 runs is not proof of absence of an engine race.

## Timeline

- 2026-11-19 [W28 capability fix](../sessions/2026-11-19-v2-engine-stop-capability.md) - advertises engine stop in `/api/info`, adds a native probe, and ships the verified vt-52 desktop install.
- 2026-11-18 [`ses_e3832b1b0ffe6q98OeUzhgqhjQ`](../sessions/2026-11-18-v2-engine-stop.md) - W24 landed, desktop install, probe fixture fix; W24b landed (`fbf2fbe0fd`) and installed on desktop as vt-51.

## Current maintenance notes

- Every owner the contract §2 names is fenced as of `fbf2fbe0fd`. The engine can advertise that contract as of W28 (`f16dced8fc`); the W28 build packet does not enable Stage 2 or authorize W15's E1-15 run.
- Launching a build or test unit from inside another systemd unit: a nested `systemd-run --user` without `--slice` lands in `app.slice` unless opencode-tools' agent-units shim (`_lib/agent-units/bin/systemd-run`) is first on `PATH`, as it is in a tool call. The first W24b build launch hit this and was refused by its slice gate before building (exit 75); put the shim on `PATH` in any waiter unit.
- Not covered by tests: an HTTP partially dispatched command, a subagent tool call during force, every scheduler timeout/rewake/heartbeat interleaving.
- m4max install deferred while it travels.
