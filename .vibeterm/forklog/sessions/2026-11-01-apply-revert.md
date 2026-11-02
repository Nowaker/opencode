# Native prompt-free pending revert

## Identity

- Workday: 2026-11-01; work began at 23:56 America/Chicago and continued after midnight.
- Session: `ses_e652b2871ffe8ePJ17VkrGTnma`
- Parent: `ses_e6531c061ffegBt3ZBgRiiwNCQ`
- Agent/platform: Hephaestus, `openai/gpt-6.1-sol`, `xhigh` / Linux; native delivery also executed on m4max macOS arm64.
- Repository: desktop `/home/nowaker/projekty/webapps/opencode`; m4max `/Volumes/projects/webapps/opencode`.
- Integration branch: `dev-nowaker`
- Development branch: `apply-revert`; clean Mac build branch: `apply-revert-install`.
- Upstream base: `006d837c50` (`v1.19.5`).
- Source result commits: `c813788a7fcf4b91d8a8f1cab9eb5191ab183f9f`, `9936a766c74cf9b23fe9e3c288fa581552ab46c1`.
- Forklog commit: this file's introducing commit, separate from source and unsquashed.

## User requests

Assigned through the parent session:

> Implement terminal/Vibeterm half of prompt-free pending message revert.

> Reuse engine cleanup without invoking SessionPrompt or admitting any input. Preserve file revert selection semantics and avoid accidental prompt draft submission; retain draft for later.

The parent later conveyed explicit authorization to finish publication and native deployment:

> Deliver native feature now, end-to-end, on desktop AND m4max per opencode-tools rules.

## Goals

- Make a pending revert permanent from the existing native UI without a replacement prompt or model turn, preserving draft and selected file behavior.
- Integrate without changing another owner's dirty paths, publish both fork mirrors, and verify independently built native installations on both hosts.

## Constraints and non-goals

- Keep `.gitignore`, `packages/opencode/src/session/retry.ts` and `packages/opencode/test/session/retry.test.ts` unmodified and uncommitted in both primary checkouts.
- Build final artifacts only from clean managed worktrees at the published source tip; no copied native artifact, fake version override or skipped migration guard.
- No upstream PR, restart of another TUI, default tmux restart, protected serve-unit restart or Meridian restart. Portal and tools documentation remain parent-owned.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| Desktop source | `apply-revert` | `5cfa2ee141` | `9936a766c7` | Two source commits; rebase onto current local primary was a no-op |
| Desktop primary | `dev-nowaker` | `5cfa2ee141` | `9936a766c7` | Fast-forward only; three existing dirty paths retained |
| GitLab and GitHub mirrors | `dev-nowaker` | `5cfa2ee141` | `9936a766c7` | Both source pushes accepted; both remote tips independently verified |
| m4max primary | `dev-nowaker` | `5cfa2ee141` | `9936a766c7` | Fetch and fast-forward only; dirty diff hash unchanged |
| m4max clean source | `apply-revert-install` | `9936a766c7` | `9936a766c7` | Managed worktree creation and native build |

The subsequent forklog commit changes documentation only. Both artifacts below were built from the same source commit `9936a766c7`, not from dirty primary checkouts or the later provenance commit.

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Prompt-free Apply revert](../features/2026-11-01-apply-revert.md) | Added | Both source commits; backend, renderer and installed HTTP proofs |
| [Messages-only revert choices](../features/2026-10-10-tui-revert-messages.md) | Existing file choice preserved by Apply | Snapshot/file preservation tests and optimistic-staging renderer case |
| [Retained prompt drafts](../features/2026-10-07-tui-prompt-admission.md) | Disabled Enter no longer submits after deferred work | Immediate textarea guard; unchanged draft-text and two-hash assertions |

## Verification

- From `packages/opencode`: `bun run test test/server/httpapi-session.test.ts test/session/revert-compact.test.ts` - 39 pass, 0 fail, 204 assertions; parent independently repeated the same result.
- From `packages/tui`: `bun run test test/routes/session` - final independent combined run: 67 pass, 0 fail, 240 assertions across nine files. The same seven new scenarios separately passed once with 37 assertions.
- From `packages/tui`: `bun run test test/component/prompt-seal.test.tsx test/component/prompt-undo.test.tsx test/component/prompt-mention.test.tsx test/component/prompt-paste.test.tsx test/prompt-seal.test.ts test/prompt-control.test.ts` - 68 pass, 0 fail, 267 assertions.
- `bun typecheck` in `packages/opencode`, `packages/tui` and `packages/client` passes; both source pushes pass all 30 workspace typecheck tasks. Changed TypeScript LSP checks, test-junk checks and `git diff --check` pass.
- Legacy SDK generator run twice gives identical artifacts; Client generator twice produces no diff. Removing cleanup makes three owner tests fail; removing the busy guard changes the expected 409 to 200; both mutations were restored.
- Real native-renderer QA uses the actual helper and generated SDK with wire-level responses and sync events, not a helper mock. It selects Revert messages from the message menu, applies through palette Enter and mouse, preserves draft text and both hashes, blocks concurrent actions, retries failures, and clears only on removal/update events. Dark/light frames at 40/80 columns retain the whole hint without clipping.
- Pre-fix QA and the parent's reviewer reproduced the draft becoming empty after an Enter pressed while Apply disabled the composer. The textarea submit handler deferred twice before checking disabled state, so Apply could finish first. `9936a766c7` rejects disabled submission before deferral; the strict assertions remain unchanged and pass.
- Evidence: desktop managed worktree `tmp/apply-revert-qa/` (`card-*.txt`, `palette-80-dark-*.txt`, `mouse-40-light-*.txt`, `busy-80-dark-busy.txt`, `run.log`).

## Build and install

- Final source commit on both hosts: `9936a766c74cf9b23fe9e3c288fa581552ab46c1`; tracked/index/untracked source status was clean before and after each final build.
- Desktop clean source: `/home/nowaker/projekty/webapps/opencode/.vibeterm/worktrees/apply-revert`. Canonical shim `~/projekty/webapps/opencode-build/build.sh` ran with `OPENCODE_SRC` set to that path, default install target, automatic version, and the absolute `vibeterm-v2-guard` path.
- Desktop installed `/home/nowaker/projekty/webapps/opencode-build/bin/opencode`: `1.19.5-vt-394-006d837c50`, 198605936 bytes, inode `49969916`, SHA-256 `26643a5b4f1005aaf8dc859b06e53c3a838d60f6a0335749d65606218f7e2c03`.
- Desktop migration guard passed at `2026-11-02T07:47:40.672Z`. Log: clean source `tmp/apply-revert-clean-build.log`.
- m4max preflight: authenticated SSH, arm64, Bun 1.4.4, Command Line Tools/clang, 74 GiB free. Clean source: `/Volumes/projects/webapps/opencode/.vibeterm/worktrees/apply-revert-install`. Its own canonical shim ran locally with explicit clean `OPENCODE_SRC`, default install target, automatic version and mandatory guard.
- m4max installed `/Volumes/projects/webapps/opencode-build/bin/opencode`: `1.19.5-vt-394-006d837c50`, 181881648 bytes, inode `53527854`, SHA-256 `8b2389e3809df1cee8b912bdf17f65db6996f88b8c096dc2003d26eef8ea9469`.
- m4max migration guard passed at `2026-11-02T07:49:33.795Z`. Log: clean Mac source `tmp/apply-revert-delivery-build.log`. No binary was copied between hosts.
- Both installed `generate` surfaces expose `session.applyRevert` with 200/400/404/409 responses. Each installed binary's isolated loopback probe seeded three no-reply messages, retained exactly one after Apply, cleared the marker, repeated unchanged and stayed idle with no AI turn; owned server reaped and scratch HOME removed.
- Desktop probe receipt: clean source `tmp/installed-revert-smoke.json`; Mac probe driver: clean source `tmp/installed-revert-smoke.ts` with its installed binary as argument.
- An earlier desktop build from the dirty primary was superseded by the final clean-source build above after the parent clarified source scope. The owner's edits were not reset, stashed or changed.
- Protected desktop serve-unit observations before and after: tailscale MainPID `0`, start timestamp `Fri 2026-10-16 03:05:06 CDT`; LAN MainPID `0`, empty start timestamp. No other TUI or Meridian was restarted. Existing processes retain their old executable inode until their owner restarts them.

## Commit provenance

- Source commits use resolved human identity `Nowaker <spam@nowaker.net>` and the session's exact model, variant, tool, platform and harness trailers.
- Required trailer: `AI-Session-ID: ses_e652b2871ffe8ePJ17VkrGTnma`.
- No history rewrite, force-push or upstream PR was performed. Resolve the forklog commit through this file's introducing history.

## Unknowns and blocked verification

- No delivery blocker remains. The pre-existing `test/server/httpapi-public-openapi.test.ts` busy-error assertion fails identically on unchanged primary (17 pass, one fail) and candidate, and was left untouched.
- The optional skill smell scanner cannot resolve a `typescript` package in this tsgo-based workspace; package typechecks, LSP checks and test-junk checks passed instead. No new dependency was introduced solely for that scanner.
