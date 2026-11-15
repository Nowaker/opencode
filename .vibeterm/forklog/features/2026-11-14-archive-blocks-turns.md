# Archived sessions refuse new turns

## Identity

- Status: active on the development branch; not installed or integrated
- Integration branch: `dev-nowaker` (unchanged by this delivery)
- Development branch: `feat/archive-blocks-turns`
- First and current local commits: see the [session record](../sessions/2026-11-14-archive-blocks-turns.md)
- Upstream base: `006d837c50` (upstream `v1`, `v1.19.5`); development starts at `4cd4357861`

## Original request

> In the opencode fork, make an archived session unable to start a turn until it is unarchived, with the engine refusing such prompts and the TUI composer showing the archive note and offering a one-key unarchive.

## Goals and constraints

- A repaired session's archived losing copy cannot accept a new prompt, slash command or shell execution accidentally.
- Keep `session.time_archived` as the archive flag and preserve loose `session.metadata.vibeterm.archive` records. No column or migration.
- Preserve `noReply` notes, pause behavior and an already running turn's internal continuation.
- Deliver the feature branch to both remotes without integrating, installing or restarting a production process.

## Contract

- `SessionPrompt.PromptInput`, `CommandInput` and `ShellInput` accept `unarchive?: boolean`. Prompt admission calls `SessionArchive.admit` before revert cleanup or message storage. The command and shell entry points check before command evaluation or execution.
- Admission calls `Session.get`, which selects the current SQLite row. An archived ordinary prompt fails with domain `SessionArchivedError`; HTTP returns status 409 with `{ name: "SessionArchivedError", data: { sessionID, archivedAt, note?, by? } }`. A foreign archive record's `sessionId` supplies neither note nor actor.
- Actors use `SessionPause.Source` fields plus `instance` and `component`: `{ kind: "tui" | "tool" | "api" | "system", sessionID?, sessionTitle?, machine?, tool?, client?, instance?, component? }`. Unknown machines are omitted; actor `sessionID` is capitalized while the archive record's top-level `sessionId` is unchanged.
- `unarchive: true` records `archive.unarchived.by.kind` as `"tui"` for the TUI's `x-opencode-client: tui` header or `"api"` otherwise, with `VIBETERM_MACHINE_NAME` when known. It preserves unknown keys, `archived` and `announcedAt`, sets the current `sessionId`, and clears the flag with `Session.setArchived` before admitting the message. An absent `announcedAt` or one older than `unarchived.at` means the unarchive still needs announcement. The flag is a no-op on an unarchived session.
- `Session.setMetadata` writes an explicit metadata replacement before publishing its update, so the stale-event projector's preservation of row-owned Vibeterm values cannot undo it. `sessionRow` projects an absent archive timestamp as SQL NULL.
- The TUI shows `archived` beside its prompt footer labels. Submission opens `Session archived` with the archive's local time, actor and note and the previous unarchive's actor and note when present. Names identify the TUI user, Portal instance, tool's session/title, or Vibeterm component and machine. Esc or Cancel preserves the draft, while Enter or `u` sends with `unarchive: true`. An HTTP refusal from a stale store restores the draft and refreshes session metadata for the same dialog. Prompt retries retain their message and part IDs; command and shell errors also restore the draft.

## Stable seams and verification

- Engine: `packages/opencode/src/session/archive.ts`, `SessionPrompt.admit`, `SessionPrompt.command`, `SessionPrompt.shell`, `Session.setMetadata`, `packages/core/src/session/projector.ts`.
- Wire: `packages/schema/src/session-archive.ts`, HttpApi session error schemas and handlers, regenerated `packages/sdk/js/src/v2/gen/`.
- TUI: `src/prompt/archive.ts`, `src/component/dialog-session-archived.tsx`, prompt admission recovery and composer submit, SDK client header construction.
- Focused engine, HTTP and pause tests: 51 pass. TUI archive and admission tests: 23 pass. OpenAPI archive contract: 1 pass. Required package typechecks pass; the earlier broader run retains the busy-error OpenAPI assertion failure documented by the pause feature. Exact commands and real-TUI evidence are in the [session record](../sessions/2026-11-14-archive-blocks-turns.md#verification).

## Timeline

- 2026-11-14: [`ses_e22bef643ffeZtFBUwr5i1K3pW`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e22bef643ffeZtFBUwr5i1K3pW) built and verified the engine backstop and human unarchive path in the assigned worktree.

## Maintenance

- Regenerate legacy SDK changes with `bun run packages/sdk/js/script/build.ts` and run `bun run generate` in `packages/client` after HttpApi changes.
- Keep archive admission outside `runLoop`; gating its internal tool or compaction continuation changes the agreed contract.
- Keep actor `machine` optional and non-null in metadata, error payloads and generated SDK types.
