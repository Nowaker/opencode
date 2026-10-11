# Unqueue a prompt waiting behind the running turn

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `revert-modes`; upstream `v1-unqueue-prompt`
- First local commit: `ddfb911883`
- Current local commit(s): `ddfb911883`
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `dfb56f76c7` (upstream `v1`, contains `v1.19.0`)
- Upstream: PR [#54437](https://github.com/anomalyco/opencode/pull/54437) (`v1-unqueue-prompt`, `d86f7b11ea`), stacked on #54436. **Needs a v2 port later.**

## Original request

Assigned by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` as item 29, quoting
the user:

> another issue to tackle is reverting of a QUEUED message when ai turn is
> active. it doesn't work at all. reverting it just gets you its text into the
> prompt field, and the old one still remains queued. this is bullshit. a
> queued message should be immediately dropped from the queue, if the turn
> still hasn't reached it (or refused a revert if it was picked up in race
> conditions between user wanting to revert and opencode running the queue),
> without stopping any turns, of course. this action should probably be called
> 'unsubmit' or 'unqueue', to distinguish it from actual reverts.

## Goals

- "Unqueue" on a QUEUED prompt removes it and puts its text and attachments
  back in the composer, without aborting the running turn.
- A prompt the turn already read is refused with a notice; nothing changes.
- After a successful unqueue the prompt never runs.

## Non-goals

- No change to how prompts are queued or picked up.
- A prompt waiting behind a `!` shell run has no loop to withdraw it from and
  is refused as `idle`.

## Rationale and constraints

- A v1 queued prompt is a stored user message; the loop picks it up when a
  step's `filterCompactedEffect` read includes it. Revert on it hit
  `assertNotBusy` (409, ignored) while the TUI still filled the composer.
- `runs` in `SessionPrompt` keeps per running loop the prompts read (`seen`)
  and withdrawn. `pickUp` filters and records in one synchronous step after
  the read; `unqueue` checks and withdraws in another, so a prompt is read or
  withdrawn, never both. A prompt created before the run started is refused
  (`idle`), so compacted-away history is never deleted.
- The fork restores into the composer with item 22's `mergeFailedPrompt`
  (above typed text, `--` separator). Upstream lacks it, so PR #54437 stashes
  the typed text instead.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `ddfb911883` | 2026-10-10 | Unqueue route, loop pickup guard, `PromptNotQueuedError`, TUI "Unqueue" action and composer restore, docs | `SessionPrompt.unqueue`, `runs`/`tracked`/`pickUp` in `packages/opencode/src/session/prompt.ts`; `POST /session/:id/message/:messageID/unqueue` (`session.unqueue`); `PromptNotQueuedError` in `httpapi/errors.ts`; `DialogMessage` `queued`/`restorePrompt`; generated `session.unqueue` |

## Verification

Session [`ses_ed759a0b4ffeCubC9xxc8hYgHY`](../sessions/2026-10-10-revert-unqueue.md):

- `bun test test/session/prompt.test.ts -t unqueue` (packages/opencode) -
  4 pass: removed before pickup and never sent; refused `started` after
  pickup and answered once; refused `idle`; the race over 24 rounds (unqueue
  0-46 ms after releasing the turn), three runs 17/7, 10/14, 12/12 removed vs
  refused, every round consistent.
- `bun test test/server/httpapi-session.test.ts -t unqueue` - 404 unknown,
  409 `PromptNotQueuedError` `idle`.
- Real PTY (throwaway tmux socket, fake provider streaming 24 s): QUEUED
  prompt, "Unqueue" as the first action, prompt gone from the database and
  back above "new draft" with the `--` separator, turn streamed on to
  completion, provider log shows no request carrying it.

## Timeline

- 2026-10-10 [`ses_ed759a0b4ffeCubC9xxc8hYgHY`](../sessions/2026-10-10-revert-unqueue.md) -
  initial build, upstream PR #54437, installed on desktop and m4max.
  Evidence: `ddfb911883`.
- 2026-10-11 [`ses_ed5f9f826ffeno6fI51rL96d5Q`](../sessions/2026-10-11-upstream-v1-19.md) -
  rebased unchanged onto upstream `v1` `dfb56f76c7` (`v1.19.0`).
  Evidence: patch-identical in `git range-diff`; that session's gates.

## Current maintenance notes

- `pickUp` must stay on the loop's message read in `runLoop`, and `tracked`
  around `runLoop` in `loop`; an upstream bump that moves the read moves the
  guard with it.
- Regenerate the SDK after touching the route.

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- Classify the customization as preserved, conflicted, superseded, or removed.
- Reverse any deliberate uncommitted patch before merging, then reapply its
  canonical patch afterward.
- Regenerate derived clients or schemas instead of editing generated files.
- Run the feature's focused tests and affected package typechecks.
- Build through the host's canonical installer and verify the installed binary.
- Confirm protected services kept the same PID and start timestamp.
- Link a new timeline row to the current session record.
- Update `Last checked against upstream`.
