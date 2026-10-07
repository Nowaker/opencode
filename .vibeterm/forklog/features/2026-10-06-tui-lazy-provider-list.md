# Load the full provider catalog after the prompt is shown

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-lazy-provider-list` (off upstream `dev` `ecc4916b5a`; also the upstream PR head), landed through `idle-perf-land`
- First local commit: `ccf60408f3`
- Current local commit(s): `ccf60408f3`
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `ecc4916b5a` (upstream `dev`)
- Upstream: issue [#53679](https://github.com/anomalyco/opencode/issues/53679), PR [#53680](https://github.com/anomalyco/opencode/pull/53680)

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 13), the user's words:

> - time to prompt when opening opencode session prompt
> - time to prompt when opening an existing session

## Goals

- The TUI shows a typable prompt without waiting for `GET /provider`.
- The connect dialog still lists every provider once the request completes.

## Non-goals

- No change to the `/provider` route or the catalog it returns.

## Rationale and constraints

- The blocking bootstrap in `packages/tui/src/context/sync.tsx` awaited
  `sdk.client.provider.list()`: 6.6 MB, 226 providers and 8,405 models for an
  install with one connected provider, 1.2 s warm and 4.1 s first call on a
  loaded desktop. The startup worker profile was dominated by
  `Provider.toPublicInfo` and JSON encode/parse through the worker RPC.
- Only the connect dialog reads `provider_next`, which already starts empty,
  so the request moves into the existing non-blocking group.
- Rejected for startup: Bun `bytecode: true` - warm relaunches unchanged
  (2216 vs 2200 ms home, 2599 vs 2541 ms large session), only the first launch
  gains about 0.5 s, binary grows 160 -> 240 MB.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `ccf60408f3` | 2026-10-06 | `provider.list()` moves from the blocking to the non-blocking bootstrap group | `bootstrap` in `packages/tui/src/context/sync.tsx`, store key `provider_next` |

## Verification

- `bun typecheck` in `packages/tui` - exit 0; `bun test test/app-lifecycle.test.tsx test/runtime.test.tsx test/context` - 9 pass on `idle-perf-land`.
- Launch to typable prompt (`opencode-idle-bench ttp`), compiled, m2pro,
  `--pure`, median (min-max) of 10 ABBA relaunches: home 2235 (2183-2277) ->
  1976 (1928-2048) ms; 3,906-message session 2575 (2523-2625) -> 2331
  (2295-2421) ms; first launch on a fresh home 2592 -> 2146 ms. Time until the
  session's last message is visible did not change (2724 -> 2708 ms).
- Manual surface: launched the linux binary hermetically, typed `/connect`
  after startup; the dialog listed the full catalog (302.AI, Abacus, ...).

## Timeline

- 2026-10-06
  [`ses_eec5b2a34ffe9sjf6Wf21vNSMg`](../sessions/2026-10-06-idle-cpu-startup.md)
  - `ccf60408f3`: introduce, measured on m2pro; upstream issue #53679 and PR
    #53680; build and install on desktop and m4max.

## Current maintenance notes

- Drop the fork commit once PR #53680 (or an equivalent) is in upstream `dev`.

### Upstream integration checklist

- Locate the blocking `Promise.all` in `bootstrap`; check `provider.list` is
  not awaited there and `provider_next` is still filled in the non-blocking
  group.
- Run the tui tests above and `bun typecheck` in `packages/tui`.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
