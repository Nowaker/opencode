# Idle CPU, idle memory and time to prompt (item 13)

## Identity

- Workday: 2026-10-06
- Session: `ses_eec5b2a34ffe9sjf6Wf21vNSMg`
- Agent/platform: `opencode` (Sisyphus, anthropic/claude-opus-5-5) / `linux`
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `lazy-log-flush`, `tui-lazy-provider-list` (both off upstream `dev` `ecc4916b5a`), landed through `idle-perf-land`; measurement-only `idle-vanilla`, `idle-fork`, `startup-bytecode`
- Upstream base: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Source result commit(s): `bb01eb1db2`, `ccf60408f3`
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`:

> finding ways, as many as possible, each separately, with before and after
> testing and comparisons, to improve the following things in opencode:
> - cpu usage when idle - opencode doing nothing should not waste cpu. it
>   should be invisible. [...]
> - memory use - including leakage of stuff over time; an idle tab should not
>   collect extra non-GC-able garbage (this is a memory leak)

Added later the same evening:

> - time to prompt when opening opencode session prompt
> - time to prompt when opening an existing session

## Goals

- A repeatable hermetic harness for idle CPU, memory slope and launch to
  typable prompt, with results preserved.
- Each waste fixed separately and kept only with a measured gain.

## Constraints and non-goals

- Measure one candidate at a time, same host, ABBA order; never profile during
  a timed run.
- Plugin-side fixes (OMO, route plugin, codelight) belong to their own
  repositories and are recorded there, not here.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `60c312f0a5` | `ccf60408f3` | cherry-pick of the two upstream PR commits, fast-forward |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Stop the file logger waking every second while idle](../features/2026-10-06-idle-log-flush.md) | introduced | -15% idle CPU, desktop and m2pro |
| [Load the full provider catalog after the prompt is shown](../features/2026-10-06-tui-lazy-provider-list.md) | introduced | -250 ms to typable prompt, m2pro |
| [Reopen opencode.log after an external rotation](../features/2026-10-03-log-reopen.md) | composed | conflict resolved into the latch flush; 9 pass |

## Other delivered work

- `opencode-idle-bench.ts` in opencode-tools (`3e5bbcf`): `run`, `abba`,
  `attach`, `ttp`, `compare`.
- Plugin fixes measured with it and landed by their workers: route plugin
  change-driven publish (opencode-tools `cefb6b4`, -12% idle CPU), codelight
  snapshot dedup (codelight `27e20e8`, -93% python child CPU), OMO TUI sidebar
  idle tick (oh-my-openagent `50b22f0fd`, -40% of an OMO tab's idle CPU).

## Verification

- `packages/core`: `bun typecheck` exit 0; `test/effect/observability.test.ts`
  9 pass on `idle-perf-land`.
- `packages/tui`: `bun typecheck` exit 0; `test/app-lifecycle.test.tsx`,
  `test/runtime.test.tsx`, `test/context` 9 pass on `idle-perf-land`.
- Baselines, % of one core, idle home screen: desktop vanilla 1.59-1.67, fork
  1.63-1.68; m2pro vanilla 2.05-2.15, fork 2.06-2.19. Large session (3,906
  messages): desktop vanilla 3.48-3.52, fork 4.28-4.29. Two real Vibeterm
  tabs with every plugin, 1 h attach: 6.48 and 6.74.
- Memory: the two real tabs' PSS moved 654 -> 676 and 659 -> 638 MB over 1 h
  (slopes -10 and -33 MB/h); no leak observed.
- Launch to typable prompt, m2pro, median of 10: vanilla 2228 ms home, 2592 ms
  large session; fork 2248 / 2604 ms.
- Raw result JSON: `tmp/idle-results/` on desktop and `~/idle-bench/results/`
  on m2pro (machine-local, untracked).

## Build and install

- Build command: `.vibeterm/build.sh` at `ccf60408f3` on both hosts.
- Desktop: installed `1.18.34-vt-142-907b3bc518` (inode `49955752`, was
  `49955668`), retry-header marker present.
- m4max: checkout fast-forwarded to `ccf60408f3`; installed
  `1.18.34-vt-142-907b3bc518` (inode `21734859`), retry-header marker present.
- Running services: none restarted; `opencode-serve-tailscale` PID `1507297`
  and `opencode-serve-lan` PID `1509289` unchanged across the desktop build.
  Running TUIs keep their old binary until restarted.

## Commit provenance

- `bb01eb1db2` - idle log flush, composed with log reopen.
- `ccf60408f3` - lazy provider list.
- Required trailer: `AI-Session-ID: ses_eec5b2a34ffe9sjf6Wf21vNSMg`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-06-idle-cpu-startup.md
```

## Historical evidence carried forward

- None.

## Unknowns and blocked verification

- Measured and dropped: `MIMALLOC_PURGE_DELAY=1000` (no gain), Bun
  `bytecode: true` (no warm-launch gain, +80 MB binary).
- Not yet attributed: the fork's +0.8 pp idle CPU over vanilla with a large
  session open.
- A `SQLITE_BUSY` `LockTimeoutError` killed one of this session's turns; the
  lock holder could not be identified afterwards.
