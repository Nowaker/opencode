# W1 v2 engine stop (W24) and its desktop install

## Identity

- Workday: 2026-11-18
- Session: [`ses_e3832b1b0ffe6q98OeUzhgqhjQ`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3832b1b0ffe6q98OeUzhgqhjQ)
- Agent/platform: `opencode 1.19.5-vt-432-006d837c50`, `anthropic/claude-opus-5-5` / `linux`
- Repository: `Nowaker/opencode` (gitlab `origin`, github `nowaker-github`); `Nowaker/opencode-tools` for the probe fix
- Integration branch: `v2-nowaker` (source), `dev-nowaker` (this record)
- Development branch(es): `client-test-baseline`, `engine-stop-seal`; `engine-stop-w24b` (uncommitted)
- Upstream base: `v2.2.7` (`fedc6f208a`)
- Source result commit(s): `235c6a4b6e`, `2f2c119414`; opencode-tools `07452e75e0`
- Forklog commit: this file's introducing commit

## User requests

No human prompt in this session; the work came from the v2 coordinator [`ses_e383ee7faffe6JX8m2EP26dXUC`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e383ee7faffe6JX8m2EP26dXUC). Its W24 landing instruction (2026-11-19T04:37Z) asked for the commit message to cover four points; it arrived after the commit had landed under the standing step, so three of them are recorded here instead (see the feature record), with the coordinator's agreement at 04:44Z.

## Goals

- Land W24 on both mirrors, install it on desktop, and prepare W24b.

## Constraints and non-goals

- No force-push of `v2-nowaker`; m4max deferred; Stage 2 off until W24b lands.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `Nowaker/opencode` | `v2-nowaker` | `6db5c23fcf` | `235c6a4b6e` | test fix: recovered-child cancellation observed through its notice |
| `Nowaker/opencode` | `v2-nowaker` | `235c6a4b6e` | `2f2c119414` | W24 engine stop (45 files, blobs equal to manifest `12b72ba2`) |
| `Nowaker/opencode-tools` | `master` | `d63164337be` | `07452e75e0` | probe fixture gate on a held loopback request |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Native v2 engine stop](../features/2026-11-18-v2-engine-stop.md) | introduced | W24 v8 packet `48e0d45a`, build packet `95e5cd26` |

## Other delivered work

- opencode-tools `07452e75e0`: the v2 probe's plugins-per-location fixture waited on a 50 ms `fs.watchFile` poll of a release file (introduced by `feb763920e9`, session `ses_e37e4b7edffeDiUT47DU30h3Dp`). With two locations' watchers in one engine the poll intermittently never fired and the check timed out after 30 s while the engine sat idle. Setup now awaits one held loopback request that the probe answers; a failure lists every step reached with its offset. Probe unit tests 93/0.

## Verification

- `235c6a4b6e`: v7-pre packet `88862f5d` green (recovered-child test 11/0 without W24).
- `2f2c119414`: W24 v8 packet `48e0d45a`, 28 rows green (W15, desktop, 2026-11-19T04:34Z).
- Probe diagnostics (not evidence, coordinator grants): old gate vt-46 3/3 green, vt-50 2/3 red (build run and run a), a different location stalling each time, the engine at ~0 CPU in sleep state with no log lines; event gate vt-50 3/3 green and vt-46 1/1 green. 3 runs is not proof of absence.

## Build and install

- Build command: `.vibeterm/build.sh --v2`, packet `w24-build/packet.json` `95e5cd26` (probe library pinned to `07452e75e0`), unit `w1-w24-desktop-2f2c119`.
- Installed artifact: desktop `opencode2` `v2.2.7-vt-50-5f76acb125`, sha256 `1d8cef6b...`, inode 49949420; probe 12/0/0; vt-46 archived as `opencode2.prev-1795067500`.
- Running services: v1 binary and the system and user `opencode-serve-*` identities unchanged; nothing restarted.

## Commit provenance

- `235c6a4b6e`, `2f2c119414` (opencode); `07452e75e0` (opencode-tools).
- Required trailer: `AI-Session-ID: ses_e3832b1b0ffe6q98OeUzhgqhjQ`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-11-18-v2-engine-stop.md
```

## Historical evidence carried forward

- None.

## Unknowns and blocked verification

- The original W24 assignment prompt is not in this session's retained history: TBD.
- W24b: source in `engine-stop-w24b`, gates packet v1 `679aded9` awaiting the coordinator's slot grant; not landed.
- m4max install: deferred while m4max travels.
