# Fork a session in the background without leaving it

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `fork-background`
- First local commit: `892325cec5`
- Current local commit(s): `892325cec5`
- Upstream base when introduced: `dfb56f76c7` (`v1.19.0`, `github/v1`)
- Last checked against upstream: `006d837c50` (upstream `v1`, contains `v1.19.5`); v2 design check against `github/dev` `8bca532929`

## Original request

Relayed verbatim by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`:

> /fork-in-background - same as /fork, but after it's confirmed, a small popup shows up that says now forking this session into newses_id, wait for confirmation when done, then another pop-up + an a message that is seen in the chat log for the user but not for the AI that fork is finished and this is the sesid.
>
> Currently running session continues. There is no context switch like in normal /fork. The AI can even have an active turn.
>
> /fork-in-background-from-this-message forks the session from the latest place. That could even include an incomplete tool call. Command executed known, result unknown.
>
> /fork-in-background-from-last-message doesn't include the incomplete part.
>
> /fork-in-background-from-last-prompt does it like /fork does it, with everything before a prompt preserved in the session log, and user prompt sitting in the prompt draft of that session. (will show when tui for that session gets opened at any point)
>
> Before beginning, check if something similar exists in v2, if so, design it in a way that it will be easier for us when upgrading to v2.

## Goals

- Three TUI commands, as slash commands and palette entries, fork the current session without switching the view, including during an active turn: `/fork-in-background-from-this-message`, `/fork-in-background-from-last-message`, `/fork-in-background-from-last-prompt`. The names are the user's; the bare `/fork-in-background` is not a separate command, because the user's three variants cover every fork point.
- Confirmation, then a toast `Forking this session into <id>…`, then `Forked this session into <id>` plus a reader-only notice in the current session with the new `ses_` ID.
- From this message: a streaming assistant answer is copied settled. Its unfinished tools get the abort error state with `metadata.interrupted` and `metadata.forked`, and the text "the command executed, its result is unknown". The fork is idle and holds no running tool.
- From last message: the streaming answer is left out.
- From last prompt: history before the newest prompt is copied, and the prompt becomes the new session's draft, persisted so any TUI process shows it on first open.

## Non-goals

- No change to `/fork` or the fork-from-message dialog.
- No keybinds for the new commands.

## Design note: v2 seams

- Fork point. v2 `SessionFork.Boundary` (`packages/schema/src/session-fork.ts`) is `{ type: "before" | "through", messageID }`, and v2's projector copies only settled history: it skips assistant rows without `time.completed`, plus running shell and compaction rows. v1 keeps `messageID` (= v2 `before`). The new optional `unsettled: "exclude"` is v2's always-on behaviour, so the v2 port of `from-last-message` is `fork({ sessionID })`, and of `from-last-prompt` it is `fork({ sessionID, before })`. v2 has no equivalent of `unsettled: "settle"`; porting `from-this-message` needs a v2 change to the projector's settled-history filter (open upstream question).
- Fork ID up front. Neither v1 nor v2 lets the caller name the new session. v1 gains optional `id`, so the first toast can show the ID. On v2 this is an additive `SessionForkInput` field, or the toast falls back to showing no ID until the fork returns.
- Background fork. Neither line has one. v2's TUI `DialogFork` and the app's `useSessionFork` both navigate to the fork. The v1 module `routes/session/fork-background.tsx` calls only the client fork plus a prompt, and ports as is.
- Reader-only notice. v2 has `session.synthetic` / `SessionMessage.Synthetic`, but synthetic messages are model-visible and promoted through the inbox, so they are not a match. v1's existing reader-only shape is a user message whose parts are all `ignored: true`, sent with `noReply` (Vibeterm's `user_message`). The TUI already classifies it as a notice (`TranscriptFilter.userKind`). The notice reuses it; nothing parallel was added. v2 has no reader-only notice yet.
- Prompt draft. v2 `packages/tui/src/component/prompt/draft-stash.ts` keeps one draft per session, consumed on take, in memory (`saveDraft`/`takeDraft`). v1 adds a file of the same name and API shape, persisted under `<state>/prompt-draft/<session>.json` because the fork's draft must survive until any process opens it. Port: make v2's stash read and write through, or keep this file.

## Rationale and constraints

- `MessageV2.latest` now skips notice-only user messages. Otherwise a notice after a finished turn became the "last user" the loop answers, and the next loop wake would run a model turn for it. The test `a reader-only notice after a finished turn does not start another` fails without this change (2 LLM calls instead of 1).
- The TUI no longer badges a notice posted during a turn as QUEUED.
- The draft is claimed by `rename`, so two TUIs opening the session at once restore it once.
- Fork-only, not upstreamable. Upstream's v1 line takes maintenance fixes only. The reader-only notice and the draft path depend on Vibeterm conventions, and v2 would need a projector change first.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `892325cec5` | 2026-11-01 | Additive fork fields `id`, `unsettled`; settle helper; notice-skipping `latest` | `Session.ForkInput`, `Session.fork`, `settlePart`, `MessageV2.latest`/`isNotice`, `POST /session/:id/fork`, generated `SessionForkData` |
| `892325cec5` | 2026-11-01 | Three TUI commands, toasts, notice, QUEUED exemption | `routes/session/fork-background.tsx`, `session.fork.background.*` commands in `routes/session/index.tsx` |
| `892325cec5` | 2026-11-01 | Persisted per-session draft restored on first prompt bind | `component/prompt/draft-stash.ts`, `bind` in `routes/session/index.tsx` |
| `892325cec5` | 2026-11-01 | Docs | `packages/web/src/content/docs/tui.mdx` `fork-in-background`, `server.mdx` fork row |

## Verification

See [the session record](../sessions/2026-11-01-background-fork.md#verification).

## Timeline

- 2026-11-01 [`ses_e66b728b8ffeIxgqjkEHgEQEui`](../sessions/2026-11-01-background-fork.md) - initial build, tests, isolated real run, install on desktop and m4max as `1.19.0-vt-384-dfb56f76c7`. Evidence: `892325cec5`.
- 2026-11-01 [`ses_e6683c468ffewy5J1dk7eU3NGi`](../sessions/2026-11-01-upstream-1.19.5.md) -
  merged with upstream `v1.19.5` without conflict. Evidence: fork tests 9 pass, prompt suite; installed-binary smoke (caller `id`, `unsettled: "settle"`, notice, `session list`) on both hosts at `1.19.5-vt-386-006d837c50`.

## Current maintenance notes

- After changing `Session.ForkInput`, run `./packages/sdk/js/script/build.ts`; `packages/client` has no fork endpoint.
- Focused tests: `packages/opencode` `bun run test test/session/fork.test.ts test/session/fork-lineage.test.ts`, `bun run test test/session/prompt.test.ts -t "background|reader-only notice"`; `packages/tui` `bun run test test/prompt/draft-stash.test.ts`.

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
