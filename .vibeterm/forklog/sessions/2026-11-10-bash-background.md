# Run bash commands in the background and move a timed-out one there

## Identity

- Workday: 2026-11-10
- Session: [`ses_e3b66e073ffeBjngD0B2e6LCl8`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3b66e073ffeBjngD0B2e6LCl8)
- Agent/platform: `Sisyphus - ultraworker` (`anthropic/claude-opus-5-5`, high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`, plus `~/projekty/forks/oh-my-openagent` and `~/projekty/nowaker/opencode-tools`
- Integration branch: `dev-nowaker`
- Development branch(es): `feat/bash-background`, `feat/fork-as-child`
- Upstream base: `006d837c50` (`v1.19.5`, `github/v1`)
- Source result commit(s): `5cc30c46fb`, merge `590273f5aa`; `db917f0795`, merge `da55aead00`; OMO `4d3effdffe`, `e16f44cb88`; opencode-tools `7c9dc8d1b1e`, `ee6b66a0052`
- Forklog commit: this file's introducing commit

## User requests

From coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv), step 6 of the same package: "`task` with `subagent_type: \"fork\"`: the child starts from a fork of the parent session, at the current message, and runs on the parent's model." Step 4 of the approved Claude Code tools package: "P2 `bash run_in_background` + a foreground command that hits its timeout moves to the background instead of being killed. opencode fork packages/opencode/src/tool/shell.ts + OMO notifier." The user: "Also make the killing configurable. I don't want that. There's subtasks that can run for an hour and it's fine. Vt timeout 2h."

## Goals

- Background bash commands with an exit notice, a timeout that moves instead of kills, a configurable background limit with a 2 h Vibeterm default, and a way to stop one.

## Constraints and non-goals

- Keep `tool_timeout`'s unlimited `task` / `call_omo_agent` exemption.
- Keep the uncommitted retry-header cap in both main checkouts.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `feat/bash-background` | `4af162d15b` | `5cc30c46fb` | feature commit |
| `opencode` | `dev-nowaker` | `4af162d15b` | `590273f5aa` | `--no-ff` merge, pushed to `origin` and `nowaker-github` |
| `opencode` | `feat/fork-as-child` | `2506760940` | `db917f0795` | feature commit |
| `opencode` | `dev-nowaker` | `2506760940` | `da55aead00` | `--no-ff` merge, pushed to `origin` and `nowaker-github` |
| `oh-my-openagent` | `dev-nowaker` | `97bc0be748` | `4d3effdffe` | fast-forward from `feat/cc-tools-step4`, pushed |
| `oh-my-openagent` | `dev-nowaker` | `4f27913625` | `e16f44cb88` | fast-forward from `feat/cc-tools-step6`, pushed |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Run bash commands in the background and move a timed-out one there](../features/2026-11-10-bash-background.md) | added | 6 shell-background tests (4 fail on the old code), 1 run-state test (fails on the old code) |
| [Let a session fork be a child of another session](../features/2026-11-10-fork-as-child.md) | added | 1 fork test (fails on the old code) |

## Other delivered work

- OMO `4d3effdffe` (`features/bash-background`): each `shell.background.exited` wakes the session that ran the command with a `<task-notification>` headed `[BASH COMMAND COMPLETED|FAILED|TIMED OUT|CANCELLED]` (exit code, output tail, output file), through its parent-wake queue on the session's agent and model; `background_cancel` stops `bash_` ids through the new cancel route via the SDK's own transport, and a command stopped that way sends no exit notice.
- opencode-tools: the spawn plugin sets `bash_background.timeout` to `7200000` unless the user set it.
- OMO `e16f44cb88`: `task(subagent_type: "fork")` creates the child with `session.fork` (`unsettled: "exclude"`, `parentID`, `title` `<description> (@<agent> fork)`, the question tool denied) and prompts it on the parent's agent and model.

## Verification

- See the feature record.
- Live, isolated (scratch XDG + HOME under /tmp, this branch's server run from source, OMO from its worktree, scripted fake LLM driving the real tools; real DB session count unchanged and sandbox sessions absent from it):
  - `run_in_background` with `exit 3`: the call returned at once with `bash_...` and the output file; about 2 s later the parent got `[BASH COMMAND FAILED]`, exit code 3, tail `first` / `second`.
  - `timeout: 1500` on a 5 s command: the call returned at 1.5 s with "moved to the background as bash_..."; the exit arrived as `[BASH COMMAND COMPLETED]`, exit code 0, tail `before` / `after`.
  - `background_cancel(taskId: bash_...)` on `sleep 67`: "Background command stopped", no exit notice, no `sleep 67` process left.
- Fork subagent, isolated, `feat/fork-as-child` from source and again with installed vt-432: the child is the parent's child, titled `fork check (@Sisyphus - ultraworker fork)`, holds the parent's earlier prompt but not its streaming task turn, runs on the parent's agent and model, answers from the copied context, and its answer wakes the parent.
- The source tree's provider defaulted to chat completions for a custom-baseURL `openai` provider in the sandbox; the QA config pins `"npm": "@ai-sdk/openai"`.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh` from each main checkout at `590273f5aa`, with the uncommitted retry-header cap. On desktop it ran as its own systemd user unit.
- Installed artifact: `1.19.5-vt-429-006d837c50` on desktop (inode 49972328) and m4max (inode 56345464); v2 guard gate PASSED on both; `.vibeterm/smoke.sh <binary>` SMOKE OK on both; `shell.background.exited` and `OPENCODE_RETRY_MAX_HEADER_DELAY_MS` present in both binaries.
- Running services were not restarted.

- `feat/fork-as-child`: the same build at `da55aead00` installed `1.19.5-vt-432-006d837c50` on desktop (inode 49972307) and m4max (inode 56383639); guard gate PASSED and SMOKE OK on both; the new `ForkInput` description and the retry-header marker are in both binaries.

## Commit provenance

- `5cc30c46fb` - feature; `590273f5aa` - merge; `db917f0795` - feature; `da55aead00` - merge.
- Required trailer: `AI-Session-ID: ses_e3b66e073ffeBjngD0B2e6LCl8`

## Unknowns and blocked verification

- The pre-push hook's monorepo typecheck goes over the tool shell's memory limit, which killed two push attempts with nothing pushed; the push then ran as a systemd user unit and passed 30/30 tasks on both remotes.
