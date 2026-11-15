# Archived session admission and TUI unarchive

## Identity

- Workday: 2026-11-14
- Session: [`ses_e22bef643ffeZtFBUwr5i1K3pW`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e22bef643ffeZtFBUwr5i1K3pW), for parent [`ses_e22cc6239ffe4aHXPpzfpA4fQQ`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e22cc6239ffe4aHXPpzfpA4fQQ)
- Agent/platform: opencode Sisyphus-Junior, `openai/gpt-6.1-sol`, xhigh / linux (desktop)
- Repository: `/home/nowaker/projekty/webapps/opencode`
- Worktree: `.vibeterm/worktrees/feat-archive-blocks-turns`
- Development branch: `feat/archive-blocks-turns`, cut from `dev-nowaker` at `4cd4357861`
- Upstream base: `006d837c50` (upstream `v1`, `v1.19.5`)
- Source result commits: `a623e23181` (engine/API/SDK), `7ab1012ec5` (requested actor and history contract revision), `e0b5216b51` (TUI)
- Forklog commit: this file's introducing commit

## User request

> In the opencode fork, make an archived session unable to start a turn until it is unarchived, with the engine refusing such prompts and the TUI composer showing the archive note and offering a one-key unarchive.

The user fixed the existing archive flag, loose archive metadata, error name and data, `unarchive?: boolean`, and the TUI confirmation labels. Work is limited to this assigned worktree and branch pushes to `origin` and `nowaker-github`. Integration into `dev-nowaker`, a build installation, production tab or serve restarts, and edits to the primary checkout are excluded.

The parent then requested the landed Vibeterm actor contract: pause-source fields with `tui`, `tool`, `api` and `system`, capitalized actor `sessionID`, optional non-null machine, `instance` and `component`; retain `announcedAt` and both history entries; show previous unarchive attribution and note. The parent explicitly approved the first commit's message-only harness correction. Its tree remained exactly `5014b3622fae3b626759d34cd14187ade7112431`; the contract revision is a separate commit.

## Feature touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Archived sessions refuse new turns](../features/2026-11-14-archive-blocks-turns.md) | New engine admission gate, HTTP/SDK contract and TUI confirmation | Tests, typechecks and real-TUI sequence below |

## Implementation

- Fresh `Session.get` reads the archive flag at admission. Refusal precedes message storage and loop start; noReply notes and the running loop's internal continuation are unchanged.
- Explicit unarchive preserves unknown metadata, the archive record and `announcedAt`, stamps the TUI/API actor with a known machine only, and publishes the cleared archive time through the session setter. Re-archiving preserves the last unarchive. Fixed two existing persistence seams exposed by the regression: the projector skipped undefined archive timestamps, and metadata merging restored row-owned values over explicit setter changes.
- The TUI's archived marker and confirmation retain text and parts, including stale HTTP refusals, slash commands and shell mode. The TUI sends `x-opencode-client: tui`; header construction uses a plain record because the SDK spreads its headers when adding the directory header.
- The generated SDK includes `unarchive`, `SessionArchivedError` and the revised pause-source actor with `machine?: string`. The dialog shows both archive and previous unarchive notes and attribution, refreshing metadata after a stale-store error without changing the error data contract.

## Verification

Commands below ran from the named package inside the assigned worktree unless a root path is shown.

- Tests first: engine cases failed on the missing refusal/unarchive implementation after correcting the fixture to register its session projector. The noReply and already-running continuation controls passed. The initial TUI run failed all 5 archive cases on the absent dialog. Before the parent-requested contract revision, four revised engine/HTTP/OpenAPI cases failed on the old actor and announcement behavior and the revised TUI case failed on missing history.
- `packages/opencode`: `bun run test test/session/archive.test.ts test/session/pause.test.ts test/server/httpapi-session.test.ts` - 51 pass, 0 fail, 273 assertions, including exact TUI and plain HTTP unarchive actors and announcement/history retention.
- `packages/opencode`: `bun run test test/server/httpapi-public-openapi.test.ts --test-name-pattern 'archive conflicts'` - 1 pass, 18 filtered, 0 fail, 8 assertions.
- `packages/tui`: `bun run test test/component/prompt-archive.test.tsx test/prompt/admission.test.ts` - 23 pass, 0 fail, 87 assertions. Covers known archived prompt/command/shell cancellation and one-key confirmation, stale prompt refusal recovery, prior-unarchive history, all four actor display forms, foreign-record note suppression and the existing prompt-admission behaviors. Extending the refused-delivery case exposed a retained automated admission on archive rejection; it failed before the targeted cleanup and passes after it.
- Before the actor/history revision, `packages/opencode`: `bun run test test/session/prompt.test.ts test/server/httpapi-public-openapi.test.ts` - 124 pass, 1 skip, 1 fail, 690 assertions. Failure: `PublicApi OpenAPI v2 errors > documents session busy errors`, whose single-$ref assertion does not accept a 409 error union. The pause [session record](2026-11-14-session-pause.md#verification) already documents this baseline failure. This session did not weaken or skip it.
- `bun typecheck` - exit 0 in `packages/opencode`, `packages/tui`, `packages/sdk/js`, `packages/schema` and the changed `packages/core`. LSP error diagnostics on the archive implementation, composer and dialog returned no diagnostics.
- Root `bun run packages/sdk/js/script/build.ts` - exit 0, generated SDK and its TypeScript build. `packages/client`: `bun run generate` - exit 0, no generated changes.
- Memory gate before broader tests: MemAvailable 64,104,120 KiB and memory pressure full avg60 1.29; the revised verification wave measured 53,865,928 KiB and full avg60 2.00. Both satisfy the requested thresholds.

## Real TUI check

- Root `bun run .vibeterm/tmp/archive-tui.ts` - exit 0. Reused the patch rig's `createScratchHome`, `Terminal`, `launcherScript` and `startFakeProvider` from `/home/nowaker/projekty/nowaker/opencode-tools/_lib/opencode-patch-rig/`.
- Source TUI ran with scratch XDG config/data/cache/state, `OPENCODE_DB`, tool/plugin stores and `OPENCODE_DISABLE_PROJECT_CONFIG=1`, an environment allow-list and a dedicated `archive-check-<pid>` tmux socket. The source command was `bun run src/index.ts --session <scratch-session> <scratch-project>`. Its scripted OpenAI-compatible provider bound loopback on a dynamic port.
- Archived the scratch row directly with `time_archived` and a matching `metadata.vibeterm.archive` repair note and previous Portal unarchive after the TUI had loaded it, exercising stale store admission. Enter opened the archive note/time/tool session/machine dialog, refreshed and showed the previous unarchive note and actor, and made zero provider requests.
- Esc left `archive kept text` in the composer and the archived marker visible. Enter reopened the dialog, and Enter on `Unarchive and send` sent exactly one provider request and stored exactly one matching text part.
- SQLite ended with `time_archived = NULL`; archived note, unknown `extra` key and `announcedAt` survived, and `unarchived.by` was exactly `{ kind: "tui" }`, omitting the unknown machine. HTTP tests separately verify known-machine TUI and API actor stamping.
- Evidence: `.vibeterm/tmp/archive-tui-1794725376197/frames/01-archive-dialog.{txt,ansi}`, `02-archive-history.{txt,ansi}`, `03-cancel-keeps-text.{txt,ansi}`, `04-unarchived-and-sent.{txt,ansi}`. The final check stopped its throwaway tmux server and fake provider in `finally`; earlier failed capture-readiness attempts also cleaned up.
- The executor inspected the revised 120-column history capture: title, both actors, both notes and actions fit without overlap. Independent reviews passed the earlier single-history dialog; a later evidence-reading attempt used the primary checkout path rather than this worktree and did not complete. Other terminal widths and themes were not exercised by this focused real-TUI check.

## Delivery and exclusions

- Source and forklog are committed separately as requested; branch tips are verified on both remotes in the delivery report.
- No merge, landing, build installation, production restart or primary-checkout edit occurred. The installed binary and running production processes do not include this branch yet.
- Trailers name the actual model and harness from mandatory session context, rather than attributing this GPT run to the requested Claude model.
