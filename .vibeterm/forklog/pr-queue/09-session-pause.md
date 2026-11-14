# 09 - Pause a session after its current step

Status: PREPARED, NOT FILED - recorded at the coordinator's instruction ("a ready-to-file entry in pr-queue (do not file)"). No upstream branch has been cut or pushed and no PR or comment was posted. Filing requires the user's authorization and a free author PR slot.

- Upstream target line: `v1`. Fork base: `006d837c50` (`v1.19.5`).
- Fork source: `d634b67a9be`, `05d3e55825c` on `dev-nowaker` (`e60728ae6eb` is a separate TUI fix and can go upstream on its own).
- Upstream issue: [#27511](https://github.com/anomalyco/opencode/issues/27511) Suspend/Resume. The v2 follow-up belongs on [#63875](https://github.com/anomalyco/opencode/issues/63875) as its `soft` mode; comment there before porting.
- Scope: `SessionPause` (`session.metadata.pause`), loop gate and deferral in `SessionPrompt`/`SessionProcessor`, `POST /session/:sessionID/pause`, `/unpause`, `/discard`, `paused` on session status, events `session.pause.updated` and `session.pause.released`, `ToolStatePending.metadata`, `unpause` on prompt and command input, regenerated SDK, TUI `/pause`, `/unpause`, `/discard` and keybind `session_pause`, docs in `tui.mdx`, `server.mdx`, `sdk.mdx`, `keybinds.mdx`.
- Changes an upstream port must make: default `session_pause` to `none` (the fork uses `alt+p`); replace the `[vibeterm_metadata]` notice text with plain text; drop `OwnerQuiescence`, the Send now refusal and the `runs` map from unqueue (upstream PR [#54437](https://github.com/anomalyco/opencode/pull/54437)) or stack on it; keep the `MessageV2` cache fix only if upstream carries the fork's row caches (message shape normalization).
- Evidence: [session record](../sessions/2026-11-14-session-pause.md), [feature record](../features/2026-11-14-session-pause.md).
- Owner: [`ses_e26c25ca4ffeYUicqdusaViOJa`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e26c25ca4ffeYUicqdusaViOJa).
- Next step, once cleared: cut a branch from the live upstream `v1`, port with the changes above, run `test/session/pause.test.ts` and the pause route test there, and write the filing command here.

## Title

`feat(opencode): pause a session after its current step and unpause it later`

## Body

Closes #27511.

Adds a graceful pause: the tool already running finishes, the current model response streams to its end, and the loop stops at the step boundary instead of calling the model again. Tool calls the model asks for after the pause are stored with their full input as `pending` parts marked `metadata.deferred` and are not run. `/unpause` runs them in order through the normal permission path and continues the turn with no new user message. `/discard` gives them a "not run" result so tool_use/tool_result pairs stay valid.

- The pause is stored in `session.metadata.pause`, so it survives a restart without a migration. Session status keeps its `type` and gains an optional `paused` field.
- While paused, prompts are stored but start no turn; a prompt sent with `unpause: true` (every TUI composer submit) runs the deferred calls first, then itself.
- Subagent sessions inherit the pause and wait at their own step boundary.
- `POST /session/:id/pause`, `/unpause`, `/discard`; events `session.pause.updated` and `session.pause.released`; TUI `/pause`, `/unpause`, `/discard` and keybind `session_pause` (default `none`).

Tests: `packages/opencode/test/session/pause.test.ts` and the pause route case in `test/server/httpapi-session.test.ts`.
