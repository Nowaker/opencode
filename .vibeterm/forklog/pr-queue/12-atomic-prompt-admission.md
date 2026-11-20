# 12 - Persist user prompts atomically

Status: READY TO FILE, NOT FILED. Damian approved queuing it on [2026-11-19 CST](https://portal.vibeterm.desktop.ts.nowaker.net/question/qst_1f08e41f5001y8P3cpGZqrKJ29). The daily PR drain files it in queue order when one of the [three author slots](00-open-slots.md) frees. Recheck upstream `v1` and rerun the regression if the base has moved.

- Target: `anomalyco/opencode:v1` at `c618499abc` (`v1.19.6`).
- Candidate: [`Nowaker:prompt-admission-v1`](https://github.com/Nowaker/opencode/tree/prompt-admission-v1), `102d16eae9`.
- Fork source: `c06c948a54` and `39873bbda9` on `dev-nowaker`.
- The fork's pause handoff belongs with the [session-pause proposal](09-session-pause.md). Upstream `v1` has neither `SessionPause` nor the fork's admission acknowledgement.
- Evidence: [session record](../sessions/2026-11-18-atomic-prompt-admission.md).

## Title

`fix(session): persist user prompts atomically`

## Body

A failed write can leave a submitted prompt in history without some or all of its content, because the user message and each part are saved separately. Commit them in one SQLite transaction and publish their events only after it commits. A failed save leaves no partial transcript or live event. The same prompt can then be retried.

The regression rejects the second part with a SQLite trigger, checks that history and event observers saw nothing, then retries the same message ID and checks both parts are present.

This PR is AI generated, but under direct supervision and on request of @Nowaker.
