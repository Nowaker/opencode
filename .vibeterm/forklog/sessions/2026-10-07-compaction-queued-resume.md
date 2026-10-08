# /compact during a running turn: queued prompts and resumption

## Identity

- Workday: 2026-10-07
- Session: `ses_ee69f1639ffeFBENk91r80bAJB`
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `compaction-queued-resume`; upstream branch `compact-during-turn`
- Upstream base: `907b3bc518` (upstream `dev`, contains `v1.18.34`); unchanged
- Source result commit(s): `42fcb7dc8f`, `06eba8720e`
- Forklog commit: this file's introducing commit

## User requests

> vibeterm/opencode/omo: i noticed that when ai is working on something, and
> i do /compact, it will stop afterwards. OMO is supposed to wake it up
> afterwards, but it doesn't. even queuing a message doesn't wake it up
> because the queued message seems to submit BEFORE compaction starts. (ai
> has turns to finish, and before it starts compacting, it adds my queue
> message before starting to compact, it seems)

> pr it to opencode when done and proved

## Goals

- A prompt queued around a mid-turn `/compact` is answered after the summary.
- With nothing queued, the interrupted turn continues after the summary.

## Constraints and non-goals

- No OMO change: its todo continuation skips while the newest message is a
  compaction marker (`Skipped: latest message is a compaction marker` in the
  OMO log for the reproduction) and relies on opencode's continuation.
- The primary checkout's uncommitted retry-header patch was left in place and
  built in, as the canonical patch requires.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `6cd2ac1a4b` | `06eba8720e`; this forklog commit later on top of `efc7b3db27` | rebase of `compaction-queued-resume`, fast-forward; pushed to `origin` and `nowaker-github` |
| `opencode` | `compact-during-turn` | `663fbd7573` (upstream `dev`) | `f641aeaf77` | cherry-pick of both commits without the fork-only `compactionDebug` call and same-ID tests, squashed, no AI trailers; pushed to `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Answer prompts queued around /compact and resume the turn it cut](../features/2026-10-07-compaction-queued-resume.md) | introduced | `42fcb7dc8f`, `06eba8720e`; tests below |

## Other delivered work

- Diagnosis from the live reproduction in this session: compaction user
  message `msg_1196256b8001oLCYdvM1bTqf0B` was created after the queued
  prompt `msg_119624a4a001ibIGqEuWzD9K4m`, and `compaction_task_start`
  logged that compaction message as `lastUserID`.

## Verification

- `bun test test/session/compaction.test.ts` - 58 pass, 1 skip; two of the
  three new tests fail on the pre-fix code.
- `bun test test/session/prompt.test.ts -t '/compact during a turn'` - 2 pass;
  both fail on the pre-fix code.
- `bun run typecheck` (packages/opencode) - clean.
- `bun test test/session` - remaining failures also fail without the change
  or pass when their files run alone.
- Manual surface: throwaway TUI tab `ses_ee62dc19cffeN2UnC0BTku4M0f` on
  desktop `1.18.34-vt-168` (the footer session's rebuild on top of
  `06eba8720e`), driven by tmux keystrokes. (a) prompt queued, then
  `/compact` during step 7 of 8: summary `msg_119d9c100…` parented to the
  compaction message `msg_119d8aa1a…`; the queued prompt was stored again as
  `msg_119da4f7e…` after the summary and answered ("13 × 29 = 377. Step 7
  finished."), then step 8 ran. (b) `/compact` during step 1 of 5 with
  nothing queued: synthetic continue message `msg_119de48dd…` after the
  summary, round 2 continued to the end. Agent, model and `high` variant
  kept on the moved prompt and the continuation. OMO log: no todo
  continuation (no todos), `compaction.autocontinue` recovery skipped because
  the session was active.
- Upstream branch: the same new tests fail on upstream `dev` `663fbd7573`
  and pass with the change; `loop calls LLM and returns assistant message`
  times out on unmodified upstream `dev` too; pre-push `bun turbo typecheck`
  30/30.

## Upstream

- Issue [#53862](https://github.com/anomalyco/opencode/issues/53862) (bug
  template) and PR [#53863](https://github.com/anomalyco/opencode/pull/53863)
  from `Nowaker:compact-during-turn`.

## Build and install

- Build command: `.vibeterm/build.sh` from the primary checkout.
- Installed artifact: desktop `1.18.34-vt-166-907b3bc518` (`42fcb7dc8f`);
  m4max `1.18.34-vt-167-907b3bc518` (`06eba8720e`, test-only on top).
- Running services: not restarted; this session's own TUI tab was restarted
  onto the desktop build. Desktop has since been rebuilt to `vt-168` by
  `ses_ee68aab01ffei41gwUGJ5ESj6W`, which still contains both commits.

## Commit provenance

- `42fcb7dc8f` - fix.
- `06eba8720e` - loop-level tests.
- Required trailer: `AI-Session-ID: ses_ee69f1639ffeFBENk91r80bAJB`

## Unknowns and blocked verification

- None
