# The TUI's pick follows the session's latest agent, model and variant

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `adopt-latest-model`, `follow-model-bump`
- First local commit: `3f66b2094a`
- Current local commit(s): `3f66b2094a`, `031bf5bc24`, `85601844ca`
- Upstream base when introduced: `006d837c50` (merge-base with `github/v1`)
- Last checked against upstream: `006d837c50`

## Original request

> DAMIAN'S RULE: the last submission wins, from any client.
> - Portal sends the model it shows, explicitly.
> - The TUI's selector switches to the model, variant and agent of the session's latest user message, even when another client (Portal, vtps, vibeterm-api) wrote that message. Portal's selector does the same for a TUI submission.
> - A vtps/vibeterm-api delivery that names a model or agent persists into later prompts that make no explicit choice.
> - A delivery that names nothing uses the last user message's model, variant and agent and changes nothing.
>
> YOUR PART (fork TUI): when a user message for the current session arrives from another client (bus event message.updated / the sync store, or the equivalent), the TUI adopts its model, variant and agent as the session's current selection, so its next submit and any prompt it injects inherit them. Don't steal the selection while the user is mid-change in the model/agent dialog; a message with no explicit model leaves the selection alone. Session switches still show that session's latest user-message choice.

(Coordinator `ses_ef8235798ffejGr4sa22eXmVNv` for the Meridian coordinator `ses_fe8a27c6effe6KEx3TRNvOLgUo` and Damian, 2026-11-18.)

## Goals

- A user message from any client (a submission here, Portal through vibeterm-api, a delivery whose profile ticket the spawn plugin rewrote under the same message ID) moves the TUI's agent, model and variant, so the next typed prompt and every `api.prompt.deliver` run on it.
- A change to the session row's `agent`/`model` published as `session.updated` (a Vibeterm model bump, which writes no message) moves the pick the same way, so the person's next prompt does not revert the bump through `setAgentModel`.

## Non-goals

- No polling of the database: a row written by another process directly reaches an open TUI only at its next session sync. Vibeterm's direct inserts carry the session's current identity (`resolveSessionIdentity`), so they never introduce a new model.
- No agent/model/variant fields on `TuiComposerDeliverRequest`; tickets carry explicit choices (agreed with `ses_e12755c8fffesT23uRF27xt4zb`).

## Rationale and constraints

- Upstream's prompt effect took the newest user message's identity only when the shown session changed. On 2026-11-18 the Meridian coordinator's injected turns kept running on `anthropic-meridian/dn-dh-c2` (spent) because the TUI's pick had been left there since 00:24, while Portal's prompts ran on `anthropic/claude-opus-5-5`.
- The key is the message's identity (id + agent + provider + model + variant), not its ID alone, because a ticketed delivery is rewritten under the same ID.
- While any dialog is open the move waits; when it closes it applies only if the person did not change the pick meanwhile.
- Only a primary agent is taken, never over a command-line `--agent`. A model this TUI does not have is skipped quietly when following another client. A signal that already matches the pick does nothing, so a submission from here does not rewrite `model.json` every turn.
- The session row's variant `"default"` means no variant.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `3f66b2094a` | 2026-11-18 | follow the newest user message's identity from any client, dialog hold, person's-own-pick-wins | `packages/tui/src/component/prompt/index.tsx` follow effect after `pauseAction`; upstream comment "Initialize agent/model/variant from last user message when session changes" |
| `031bf5bc24` | 2026-11-18 | also follow the session row's `agent`/`model` from `session.updated`; the row wins on open | same effect, `sessionPick` / `messagePick` |
| `85601844ca` | 2026-11-18 | change the stored next-turn model through a model-only PATCH without touching session activity time; publish the normal `session.updated` | `packages/opencode/src/session/session.ts` `setModel` and the v1 `SessionHttpApi.update` handler |

## Verification

- `bun test test/routes/session/adopt-latest-selection.test.tsx` in `packages/tui` - 9 pass, 0 fail (other-client message, rewrite under the same ID, dialog hold, person's change wins, non-primary agent, row bump, message after bump, unrelated session update, dialog holds a bump).
- `bun typecheck` in `packages/tui` - clean.
- Full `packages/tui` suite - 906 pass, 1 skip, 1 fail at load average 222: `prompt-undo` "undo brings back a line deleted with ctrl+u", which passed 2/2 in isolation both with and without this change at load 38-55; a keystroke delayed past `PromptUndoPauseMs` (1 s) splits its undo group. Pre-existing load flakes fixed alongside: `329b87dfc7`, `69ef861397`, `ce2f63eb5f`.
- Manual surface, isolated v1 TUI (scratch XDG/DB, throwaway tmux socket, fake provider): `prompt_async` naming `plan`/`other-model`/`high` -> footer `Plan · Other Model · high`, next typed prompt stored as `plan`/`other-model`/`high`. Unchanged `dev-nowaker` control: footer stayed `Build · Fake Model`, typed prompt `build`/`fake-model`.
- Initial manual surface, same rig: a direct row write followed by a metadata PATCH updated the footer and next prompt, but that PATCH advanced `time.updated`. Vibeterm commit [`4897aee`](https://gitlab.com/Nowaker/opencode-tools/-/commit/4897aee) replaces this path. Its two isolated real-engine tests verify that the model-only PATCH preserves the time in the persisted row and live event, and the next prompt uses the new model. The fork's session and HTTP suites passed 55 tests; disabling the write transaction made the concurrent-update regression fail.

## Timeline

- 2026-11-19 [Manual unpause uses the composer selection](../sessions/2026-11-19-unpause-composer.md) - reader-only notices do not move the TUI pick, even when their message event arrives before their parts.
- 2026-11-18 [`ses_e125a808bffe4hXOhbX6YgWjvL`](../sessions/2026-11-18-follow-latest-selection.md) - initial build.
- 2026-11-18 [`ses_e121d0821ffePgkVtkTFCzTEv6`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e121d0821ffePgkVtkTFCzTEv6) - preserve activity time when setting the next-turn model; restore two confirmed historical timestamp changes from adjacent events.

## Current maintenance notes

- On an upstream bump, check that `createUserMessage` still calls `Session.setAgentModel` when a turn's profile differs, and that `sync.tsx` still reconciles `session.updated` into `store.session`.
- A model-only PATCH acknowledges support with `x-vibeterm-session-model: 1`; an older engine may return `200` while dropping the field. The full-row snapshot and its projection share a write transaction so a model switch cannot revert another writer's activity or title.
- Upstreamable as one TUI change; see [pr-queue entry 11](../pr-queue/11-follow-latest-selection.md).
