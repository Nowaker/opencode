# Run bash commands in the background and move a timed-out one there

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `feat/bash-background` (cut from `dev-nowaker` `4af162d15b`)
- First local commit: `5cc30c46fb`
- Current local commit(s): `5cc30c46fb`, merge `590273f5aa`
- Upstream base when introduced: `006d837c50` (`v1.19.5`, `github/v1`)
- Last checked against upstream: `006d837c50`

## Original request

Coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv), step 4 (P2) of the Claude Code tools package in `opencode-tools/docs/research/2026-11-01-claude-code-tools.md`: "P2 `bash run_in_background` + a foreground command that hits its timeout moves to the background instead of being killed." The user's change for the whole package: "Also make the killing configurable. I don't want that. There's subtasks that can run for an hour and it's fine. Vt timeout 2h."

## Goals

- `bash` takes `run_in_background`: the call returns at once with the command's ID and output file, and the command keeps running.
- A foreground command still running at its timeout moves to the background instead of being killed (a bare `sleep` is still killed).
- A plugin learns when a background command starts and exits, and can stop one.
- The background runtime limit is a setting; `false` means none.

## Non-goals

- No model-facing notice from opencode itself: OMO turns the exit event into the notice (OMO `4d3effdffe`).
- No change to `tool_timeout` or its unlimited `task` / `call_omo_agent` exemption.

## Rationale and constraints

- Upstream already has `BackgroundJob` (`packages/core/src/background-job.ts`), which native `task` uses for background subagents. Every bash call now runs its process inside a job, so promoting it keeps the process alive after the call returns, with no second spawn path.
- The output streams to a truncation-dir file from the moment the command goes to the background, so the whole output stays readable.
- A turn cancel used to cancel every running job of the session (`cancelBackgroundJobs` in `run-state.ts`). That now skips bash jobs: a foreground command is still stopped by its call's abort signal, and a background one, like a dev server, outlives the turn. Session removal still stops it. Without this, cancel took about 1 s to finish the bash part and the processor's 250 ms wait marked it "Tool execution aborted".

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `5cc30c46fb` | 2026-11-10 | `run_in_background` parameter and the "Background commands" description section | `parameterSchema`, `backgroundSection`, `render(..., onTimeout)` in `packages/opencode/src/tool/shell/prompt.ts` |
| `5cc30c46fb` | 2026-11-10 | Process inside a BackgroundJob; promote at timeout; background cap; exit event | `run` in `packages/opencode/src/tool/shell.ts` (`runProcess`, `backgroundCap`, `publishExited`, `started`, `BARE_SLEEP`) |
| `5cc30c46fb` | 2026-11-10 | Events `shell.background.started` / `.exited` | `packages/schema/src/shell-background-event.ts`, `event-manifest.ts` |
| `5cc30c46fb` | 2026-11-10 | Config `bash_background.timeout` (default 1800000, `false` = none), `.on_timeout` (`background` \| `kill`) | `bash_background` in `packages/core/src/v1/config/config.ts` |
| `5cc30c46fb` | 2026-11-10 | `POST /experimental/background/{jobID}/cancel` | `backgroundCancel` in `server/routes/instance/httpapi/groups/experimental.ts` and `handlers/experimental.ts`; SDK `experimental.background.cancel` |
| `5cc30c46fb` | 2026-11-10 | Turn cancel leaves bash jobs alone | `cancelBackgroundJobs` in `packages/opencode/src/session/run-state.ts` |
| `5cc30c46fb` | 2026-11-10 | Tests and docs | `test/tool/shell-background.test.ts`, `test/session/run-state.test.ts`, httpapi exercise row, `parameters.test.ts` snapshot; `config.mdx` "Background commands" |
| `590273f5aa` | 2026-11-10 | Fork merge, no conflicts | - |

opencode-tools: the spawn plugin's `config` hook sets `bash_background.timeout` to `7200000` unless the user set it.

## Verification

- `test/tool/shell-background.test.ts`: 6 pass; with `shell.ts` at `4af162d15b`, the 4 new-behaviour tests fail.
- `test/session/run-state.test.ts`: 5 pass; the new cancel test fails without the `run-state.ts` change.
- `shell.test.ts`, `shell-background`, `parameters`, `session/prompt.test.ts`, `task.test.ts` under `SHELL=/bin/bash`: 209 pass, 3 fail; the same 3 `external_directory` permission tests fail on `4af162d15b`.
- httpapi exercise coverage and auth modes: 210 pass, the 5 missing scenarios predate this change; the new route passes in effect mode (`project.initGit` fails there on the base too).
- `tsgo --noEmit` clean in `opencode`, `core`, `schema`, `sdk/js`.
- Live, with OMO: see the session record.

## Timeline

- 2026-11-10 [`ses_e3b66e073ffeBjngD0B2e6LCl8`](../sessions/2026-11-10-bash-background.md) - initial build. Evidence: `5cc30c46fb`, merge `590273f5aa`.
- 2026-11-11 [`ses_e3b66e073ffeBjngD0B2e6LCl8`](../sessions/2026-11-11-bash-exit-duration.md) - the exit event's `durationMs` runs from the spawn to the process exit, not from the call to the publish; a loaded host's slow spawn had made `sleep 5; exit 3` report 41s. Evidence: `2e8e50f138`, merge `60daedd693`.

## Current maintenance notes

- If upstream gives bash its own background mode, compare it with `run` in `shell.ts` and the two events before keeping this.
- `BackgroundJob` entries are process-local: a background command dies with the opencode process, and nothing reports it.
- Regenerate the SDK with `./packages/sdk/js/script/build.ts` after touching the route or the events.

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- Classify the customization as preserved, conflicted, superseded, or removed.
- Reverse any deliberate uncommitted patch before merging, then reapply its canonical patch afterward.
- Regenerate derived clients or schemas instead of editing generated files.
- Run the feature's focused tests and affected package typechecks.
- Build through the host's canonical installer and verify the installed binary.
- Confirm protected services kept the same PID and start timestamp.
- Link a new timeline row to the current session record.
- Update `Last checked against upstream`.
