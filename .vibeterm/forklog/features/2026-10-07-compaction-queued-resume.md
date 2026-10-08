# Answer prompts queued around /compact and resume the turn it cut

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `compaction-queued-resume`
- First local commit: `42fcb7dc8f`
- Current local commit(s): `42fcb7dc8f`, `06eba8720e`
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `907b3bc518`

## Original request

> vibeterm/opencode/omo: i noticed that when ai is working on something, and
> i do /compact, it will stop afterwards. OMO is supposed to wake it up
> afterwards, but it doesn't. even queuing a message doesn't wake it up
> because the queued message seems to submit BEFORE compaction starts. (ai
> has turns to finish, and before it starts compacting, it adds my queue
> message before starting to compact, it seems)

## Goals

- A `/compact` sent while a turn is running does not swallow a prompt the
  user queued before or after it: that prompt is answered after the summary.
- With nothing queued, the turn the compaction cut into continues after the
  summary instead of stopping.
- A `/compact` of an idle session still just compacts and stops.

## Non-goals

- No OMO change: OMO's todo continuation deliberately stands down while the
  newest message is a compaction marker and relies on opencode's
  post-compaction continuation, which now fires for this case.
- Auto (overflow) compaction behavior is unchanged.

## Rationale and constraints

- `POST /session/:id/summarize` stores the compaction user message and calls
  `loop`; when a turn is already running, the running loop picks the
  compaction task up between two steps. `SessionPrompt.runLoop` then passed
  `lastUser.id` as the summary's parent, which was the user's queued prompt
  whenever one existed, so the prompt went into the summarized history and
  nothing was left to answer.
- `SessionCompaction.process` added the synthetic "Continue if you have next
  steps" message only when `auto` was true, so a manual compaction always
  ended the run. OMO logs `Skipped: latest message is a compaction marker`
  and waits for that continuation.
- A queued prompt is moved behind the summary by storing it again under a new
  ascending message ID and removing the original, because the loop orders
  messages by ID. Synthetic-only user messages are plugin notes and stay.
- The continuation uses the interrupted turn's own user message (agent, model
  and variant), because the TUI's `/compact` request carries the model
  without its variant.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `42fcb7dc8f` | 2026-10-07 | Parent the summary to the compaction message; defer queued prompts behind it; resume an interrupted turn after a manual compaction | `SessionPrompt.runLoop` compaction branch (`task.messageID`, `inflight`, `resume`); `SessionCompaction.process` `deferQueued` / `resume`; `queuedPrompts` in `session/compaction.ts` |
| `06eba8720e` | 2026-10-07 | Loop-level tests of `/compact` during a held turn | `test/session/prompt.test.ts` `compactDuringTurn` |

## Verification

- `bun test test/session/compaction.test.ts` - 58 pass, 1 skip; the three
  new tests ("moves prompts queued around an in-flight compaction behind the
  summary", "resumes the interrupted turn after a manual compaction", "leaves
  a manual compaction of an idle session stopped") - the first two fail on
  the pre-fix code.
- `bun test test/session/prompt.test.ts -t '/compact during a turn'` - 2 pass;
  both fail on the pre-fix code.
- `bun run typecheck` (packages/opencode) - clean.
- `bun test test/session` - remaining failures also fail without the change
  or pass when their files run alone (timing under load).
- Manual surface (session `ses_ee62dc19cffeN2UnC0BTku4M0f`, desktop
  `1.18.34-vt-168`): during an 8-step bash turn a prompt was queued and
  `/compact` sent right after it; the summary's parent was the compaction
  message, the prompt was stored again behind the summary and answered there,
  and the steps continued (`inflight: true, resume: true` in
  `compaction-debug.log`). With nothing queued, `/compact` mid-turn was
  followed by the synthetic continue message and the turn resumed by itself,
  with the turn's agent, model and `high` variant. OMO's
  `compaction.autocontinue` hook now fires for the manual compaction; its
  agent-config recovery is skipped because the session is already active.

## Timeline

- 2026-10-07 [`ses_ee69f1639ffeFBENk91r80bAJB`](../sessions/2026-10-07-compaction-queued-resume.md) -
  initial build. Evidence: `42fcb7dc8f`, `06eba8720e`, linked session.

## Upstream

- Issue [#53862](https://github.com/anomalyco/opencode/issues/53862), PR
  [#53863](https://github.com/anomalyco/opencode/pull/53863) from
  `Nowaker:compact-during-turn` (`f641aeaf77`, one commit on upstream `dev`
  `663fbd7573`, without the fork-only `compactionDebug` payload). When it
  merges, the fork's commits become upstream content at the next bump.

## Current maintenance notes

- The `compactionDebug` payload fields `compactionMessageID`, `inflight` and
  `resume` belong to the fork-only compaction tracing
  ([Compaction decision tracing](./2026-06-16-compaction-decision-tracing.md)).

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- Classify the customization as preserved, conflicted, superseded, or removed.
- Run `test/session/compaction.test.ts` and the `/compact during a turn`
  tests in `test/session/prompt.test.ts`.
- Build through `.vibeterm/build.sh` and verify the installed binary.
- Link a new timeline row to the current session record.
- Update `Last checked against upstream`.
