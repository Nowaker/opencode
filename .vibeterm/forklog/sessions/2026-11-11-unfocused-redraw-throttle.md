# Land the unfocused TUI redraw throttle

## Identity

- Workday: 2026-11-11
- Session: [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv)
- Agent/platform: `Sisyphus` (`anthropic/claude-opus-5-5`, high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `feat/unfocused-redraw-throttle`, authored by [`ses_e32daf5bfffe61E4hf2Qd3Z9Pu`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e32daf5bfffe61E4hf2Qd3Z9Pu) for [`ses_eadf5bbb2ffe8BKh7jReU7gfet`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_eadf5bbb2ffe8BKh7jReU7gfet)
- Upstream base: `006d837c50` (`v1.19.5`, `github/v1`)
- Source result commit(s): `af890118450` (fast-forward)
- Forklog commit: this file's introducing commit

## User requests

Damian in [`qst_1cbcfd662001z8rkCfWS1hkYM8`](https://portal.vibeterm.desktop.ts.nowaker.net/question/qst_1cbcfd662001z8rkCfWS1hkYM8), Q2 "Build it":

> roll it out on desktop and m4max; existing tabs pick it up when they restart

## Goals

- `dev-nowaker` carries the unfocused redraw throttle, built and installed on desktop and m4max.

## Constraints and non-goals

- Fast-forward only; no rebase or force-push of `dev-nowaker`.
- No running tab is restarted; tabs pick the build up on their own restart.
- Keep the uncommitted retry-header cap in both main checkouts.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `1c41f7829be` | `af890118450` + this record | fast-forward, then forklog commit |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Slow animation frames in an unfocused TUI](../features/2026-11-11-unfocused-redraw-throttle.md) | added | TUI suite below; benchmark in the feature record |

## Verification

- `bun test` in `packages/tui` at `af890118450` - 878 pass, 0 fail (879 tests).
- `bun test` in `packages/tui` at `1c41f7829be` - 877 pass, 1 fail: `deliver-past-ask.test.tsx`, which fails intermittently on both commits (3 of 6 runs on the base, 5 of 6 on the feature in a back-to-back loop) with an `ENOENT` rename of the test's scratch `model.json`.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh`, then `.vibeterm/smoke.sh`, on desktop and then m4max.
- Installed artifact: see the commit message of this record's commit and the coordinator's report.

## Commit provenance

- `af890118450` - feature commit, `AI-Session-ID: ses_e32daf5bfffe61E4hf2Qd3Z9Pu`.
- Required trailer for this record: `AI-Session-ID: ses_ef8235798ffejGr4sa22eXmVNv`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-11-11-unfocused-redraw-throttle.md
```

## Unknowns and blocked verification

- `deliver-past-ask.test.tsx` flake is pre-existing and not fixed here.
