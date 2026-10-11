# Idle-safe Vibeterm restart prerequisites

## Identity

- Workday: 2026-10-11
- Session: `ses_ee0ceb1aaffeh6u0RxoARcBsk1`
- Agent/platform: Hephaestus / darwin
- Integration branch: `dev-nowaker`
- Development branch: `owner-quiescence`
- Upstream base: `dfb56f76c7637d5d34167bba405fe23f916f37e9`
- Source results: `bd2840ad04`, `6deb4c2570`
- Forklog commit: this record's introducing commit

## User request

> restart when no active turns except yours, and after idlepark feature being implemeenetd on desktop introduces idle parkign without status loss for red trinagle status sessions. (ask to be notified)  if you complete all other tasks and are still waitinf for other sessions to stop working, look at vt schedule meridian restart and write a similar vt schedule tmux restart. should take over its design, etc, DRY, share code, param names,, defautl values etc.

## Features touched

- [Cooperative owner retirement](../features/2026-10-11-owner-retirement.md):
  admission lifetime, terminal commitment, native seal/flush and exact-seal exit.

## Branch movement and other work

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| OpenCode | `dev-nowaker` | `fef2eadc85` | `6deb4c2570` | Fast-forward two verified source commits |
| opencode-tools | `master` | `f96edde2` | `6c199a72` | Fast-forward shared restart queue and fenced replacement |
| tmux | `master-nowaker` | `ae0b1321` | `0ec59e6d` | Status-only VS16 cursor resynchronization |

The tools scheduler preserves shared Meridian action/default/request semantics,
persists retirement authorization before any owner exit, fences startup and
producer paths across worker death, and waits for terminal stop/start receipts.
No default tmux or Meridian restart was performed during implementation/QA.
Existing primary retry-header customization and unrelated edits were preserved.

## Verification

- Rebased tooling run: 234 passed, 4 skipped, 685 assertions; runtime replacement
  passed normally and after actual worker SIGKILL at retirement intent.
- Real ordinary/warm source TUI retirement tests passed; native drafts retained
  text, pasted parts and caret through cooperative owner exit and relaunch.
- Full live-owner scheduler: 20 assertions, real detached worker/server replacement,
  native-dialog refusal, no model turn and exact successor draft consumption.
- Real Linux systemd handoff: 2 tests, 14 assertions, target-service and PartOf
  scope survival in isolated Docker.
- Real managed Linux replacement/recovery: 2 tests, 57 assertions on Bun 1.4.3,
  matching socket PID/MainPID, terminal manager-job receipts and parked error state.
- Independent review found a terminal-tab admission bypass; the shared creation
  seam was fenced and re-review found no remaining blocking defect.

## Build and install

- m4max: `OPENCODE_TAG_REMOTE=upstream .vibeterm/build.sh` passed its v1/v2 database
  guard gate and installed `1.19.0-vt-216-dfb56f76c7` by inode swap.
- m4max log: `/Volumes/projects/nowaker/opencode-tools/.vibeterm/tmp/opencode/owner-retirement-m4max-build.log`.
- Desktop: canonical host build and v2 guard passed; installed the same
  `1.19.0-vt-216-dfb56f76c7` from source `6deb4c2570`. Logs are below
  `/home/nowaker/projekty/nowaker/opencode-tools/tmp/desktop-rollout-ed3-*`.
- Installed macOS binary: isolated HTTP admission proof passed 26 assertions;
  installed native TUI retirement/relaunch passed 30 assertions, preserving
  typed text, pasted parts and caret through exact-owner cooperative exit.
- Desktop isolated retirement/scheduler E2Es passed 5 tests; public CLI checks
  passed 27 tests. Installed health/seal/CAS release and help/error paths passed.
- Desktop refreshed only collector, namer and navbar. Live tmux PID `2084159`,
  Meridian dev/og `58328`/`260953`, and protected serve PIDs/start times stayed
  unchanged. Its tooling tip `d5ece1d7` retains verified ancestor `6c199a72`.
- No provider/model/variant settings changed. Live tmux restart remains conditional
  on the user-authorized idle gate and preserved parked attention.

## Runtime caveats

- Bun 1.3.13 failed managed restoration with `EBADF`; the fence correctly remained.
  Bun 1.4.3 passed the same real-manager chain. Desktop already has a user-owned
  1.4.3; non-interactive SSH PATH selected an older `/usr/bin/bun`.
- Package dependency installation repaired the first push hook failure; hooks
  were not bypassed. Source tips were pushed to GitLab and GitHub.
- Required provenance: `AI-Session-ID: ses_ee0ceb1aaffeh6u0RxoARcBsk1`.
