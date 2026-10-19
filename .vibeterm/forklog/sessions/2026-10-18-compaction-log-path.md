# Compaction diagnostics follow the runtime log directory

## Identity

- Workday: 2026-10-18
- Session: `ses_eae68f338ffepUkW4TfyEKqFCp`
- Agent/platform: Hephaestus / Linux; delegated native macOS build to `ses_eae502c54ffe0Nd4INc6fmgqoE`.
- Repository: `/home/nowaker/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch: `compaction-log-path`
- Upstream base: `dfb56f76c7` (`v1.19.0`), unchanged.
- Source result: `99c94db64bc31b9e267bd472ccd11e3bea184451`.
- Forklog commit: this file's introducing commit.

## User request

Coordinator `ses_eeda1d251ffel81U5Y42j4kb33` supplied the explicit user decision in `qst_1519082b500127OjyLJRQV3J0o`, answered 2026-10-19T00:34:53Z:

> Keep log, fix location

## Goals and constraints

- Write `compaction-debug.log` beside normal runtime logs using existing `Global.Path.log`, derived from XDG data settings at process startup.
- Preserve always-on diagnostics, filename, serialization, cached recursive directory creation, awaited append and ignored logging failures. No diagnostic event/field, decision formula, model, cadence, retention or opt-in change.
- Preserve primary `.gitignore` and retry-cap source/test divergence. Do not touch the concurrent worker's test-runner wiring, tools inventory or AI_TODO.
- No live server, TUI, Vibeterm, Portal or Meridian restart; no real provider calls or production database use during QA.

## Branch movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| desktop fork | `compaction-log-path` | `885476e99f` | `99c94db64b` | Fresh managed worktree, one source/regression commit |
| desktop fork | `dev-nowaker` | `885476e99f` | `99c94db64b` | Fast-forward integration; both fork mirrors pushed |
| m4max fork | `dev-nowaker` | `885476e99f` | `99c94db64b` | Fast-forward source; dirty retry and ignore paths preserved |

Concurrent primary commits after this source integration are preserved, not attributed to this session.

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Compaction decision tracing](../features/2026-06-16-compaction-decision-tracing.md) | Runtime location corrected, diagnostics retained | Source diff changes only one import and destination constant; regression and installed HTTP proof |

## Verification

- From `packages/opencode`, under a sanitized process environment with external scratch HOME/XDG/TMPDIR/cache/tool/plugin stores: `bun test test/session/prompt.test.ts -t 'compaction diagnostics use the runtime log directory' --timeout 30000` fails baseline with `ENOENT` at the intended XDG log path (`0 pass, 1 fail`), then passes candidate (`1 pass, 0 fail`, five assertions).
- Regression calls existing `compactDuringTurn`, filters JSONL by the created session ID, checks task start/end, three provider calls and resumed response. The preload's HOME and XDG data locations differ, so the old destination cannot satisfy the canonical-write assertion.
- `bun typecheck` in `packages/opencode` passes. Normal pushes ran all 30 workspace typecheck tasks successfully; no hooks skipped. Changed source/test LSP diagnostics are clean.
- Final focused run: `bun test test/session/prompt.test.ts test/session/compaction.test.ts -t 'compaction|compact during|shell completion resumes queued loop callers' --timeout 30000`: `43 pass, 1 skip, 0 fail` in 71.76 seconds.
- Broader candidate prompt/compaction run: `144 pass, 2 skip, 1 fail` in 295.01 seconds, with `shell completion resumes queued loop callers` timing out at 10 seconds. Baseline-order run with the old destination and the new location regression excluded: `142 pass, 2 skip, 2 fail` in 425.27 seconds, in different three-second tests (`loop sets status to busy then idle`, `finalizes assistant when cancelled before processor creation completes`). The baseline shell case passes alone and the final candidate focused run passes it. These are observed timing failures, not a fully green broad-suite claim or a fix to unrelated scheduler tests.
- Oracle `ses_eae5ccdbdffeEqafO0xQO0VS3e`: APPROVE, no blocking findings. Reviewer noted that the regression's old-path assertion checks existence rather than content; installed manual QA uses a sentinel content check. Coordinator independently read the source diff and path helper.

## Installed runtime proof

- Desktop installed binary: loopback-only server and synthetic OpenAI-compatible HTTP provider in a sanitized subprocess; create session, post a no-reply fixture message, call `/session/:id/summarize`.
- Actual compaction returned true with one local provider call. JSONL under isolated `data/opencode/log/compaction-debug.log` contained `compaction_task_start` and `compaction_task_end`, 445 bytes, result `continue`. The fake old-home log retained exact `legacy-sentinel` contents. No production HOME, provider credentials, tools/plugin stores or database were loaded.
- Scratch driver `http-proof.ts` and result were under tools scratch `compaction-log-path/run-uZ9222`; the coordinator received its reusable invocation before cleanup. The regression remains tracked; scratch paths are evidence provenance, not a promise of permanent files.
- Desktop CLI was used in owned tmux: version/help exited 0, `serve --port not-a-port` exited 1; the owned tmux session was closed.

## Build and install

- Desktop tracked `.vibeterm/build.sh` built and installed source `99c94db64b` as `1.19.0-vt-346-dfb56f76c7`, inode `49970756`, size `172698736` bytes. The mandatory v1 guard passed against built v1, npm `opencode-ai@1.19.3` and `@opencode/cli@2.0.32`; all six v2 guard-variant attempts exited 1 naming the poison and left the full logical dump unchanged. This proves those exact comparison versions, not future releases.
- Desktop protected units' PID/start facts were unchanged: tailscale MainPID 0 with retained prior start `2026-10-16 03:05:06 CDT`; LAN MainPID 0 with no start. No protected runtime restart occurred.
- m4max: native compilation/signing and version smoke passed at source `99c94db64b`; the initial guard refused downloading `opencode-darwin-arm64@1.19.3` because free space 50.3 GB was below the 92.9 GB reserve. No install occurred on that attempt; checking the guard's normally supported cached comparison contract. Final result: TBD.

## Commit provenance and cleanup

- Source `99c94db64b` and this separate unsquashed forklog commit carry the current mandatory AI trailers and `AI-Session-ID: ses_eae68f338ffepUkW4TfyEKqFCp`.
- Source commit mistakenly recorded `AI-Harness: Vibeterm 2ff28900bd5`; the authoritative session context requires `Vibeterm 6a72be9ff9b`. This record corrects attribution without rewriting history. Model, variant, tool version, platform and session ID are unchanged.
- Owned-resource cleanup: TBD after remaining host proof and coordinator driver use. Historical scratch and unrelated dirty primary files are not cleanup targets.
