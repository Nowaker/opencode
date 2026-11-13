# Native v2 plugin session and Job controls

## Identity

- Status: active. Source integration: `v2-nowaker`; provenance: `dev-nowaker`.
- Development branches: `plugin-messages`, `subagent-notices`, `child-cancellation`.
- First local commit: `457cab7c5e`. Native subagent commits: `de4fe36eee`, `1d2ebb120e`. Cancellation commit: `ea2e468b53`.
- Upstream base: `v2.2.7`, `fedc6f208aa2bd54c1019227214568083f6380ad`. These changes have no Vibeterm runtime dependency; they are candidates for the upstream v2 line, with no upstream PR claimed here.

## Request and constraints

The W1 assignment adds the native APIs OMO needs for context forks, completion notices, message recovery after compaction and truthful background cancellation. The full initial API-assignment prompt is TBD in this record. The surviving continuation requests finishing the admission review, publishing native subagents followed by cancellation, one gated desktop install and the forklog; it is quoted in the [delivery session](../sessions/2026-11-13-v2-plugin-controls.md).

- Keep omitted options compatible with existing behavior; advertise optional capabilities on both `GET /api/info` and plugin `ctx.app.capabilities`.
- Use native durable storage and execution ownership. No remote cancellation protocol, new database migration, parallel Job registry or polling worker is introduced.
- Builds use published source, scratch runtime paths and an explicit `OPENCODE_DB`. Existing v1 processes and protected serve units are not restarted.

## APIs and stable seams

- `ctx.session.messages(input)` in Promise and Effect plugins exposes the existing message-list pager, including durable successful tool metadata before compaction. `context()` stays the compacted model view. Capability: `sessionMessages`.
- Pager inputs and outputs match `client.message.list`: default descending order and limit 50, then follow the returned cursor with the same type filter and omit `order`. Promise/HTTP exhausted cursors are null; stop on empty data or a falsy next cursor. Core owner: `session/message-page.ts`; HTTP reuses it.
- Ordinary plugin `ctx.session.fork({ sessionID, before? })` projects the existing Session fork API. Native `subagent` adds `fork?: boolean`, `notice?: "each" | "none" | { group: { id, index, total } }` and `foregroundHandoffMs?: number`. Capability: `subagentOptions`.
- A native fork copies settled current context, preserves direct parent/title/model/agent, and excludes unsettled messages. `SessionHistory`'s `fork` boundary retains native checkpoints and their model-dependent fallback since the latest textual compaction. Retained compaction text is frozen without a dangling `keepID`. New and resumed fork output is selected after that invocation's prompt, including long and recovered runs.
- Own-primary forks resolve the parent's effective agent, including an implicit configured default. Ordinary primary subagents remain denied. Resume a verified fork child with `sessionID` and omit `fork`.
- Notice omission means `each`; `none` also suppresses recovered notices. Fixed, zero-based group slots register before launch validation in existing KV storage. Failed/cancelled launches settle their slots; one stable synthetic admission ID deduplicates delivery after all slots are terminal. Uninvoked slots remain pending and appear in `experimental.idle.background` as `subagent-group`.
- `SubagentJob` uses the existing keyed mutex for the short admission interval through Job startup. Durable slot claims and under-lock ownership checks prevent competing group/ordinary admissions from mutating a losing invocation. Foreground waiting occurs outside the mutex. Positive handoff times background the wait without interrupting execution.
- Startup group recovery captures the initial slot generations before waking parents, then delivers ready notices with the existing suspended-parent policy. Idle parents wake; suspended resume budgets remain enforced. Recovery retains its existing assumption that the prior process owner is dead.
- `ctx.session.cancelChild({ parentID, sessionID })` and `POST /api/experimental/session/:parentID/children/:sessionID/cancel` check persisted child ownership before effects. Capability: `childCancellation`. Core owner: `session/child-cancellation.ts`.
- `ctx.job.list({ parentSessionID, descendants? })` returns `{ data: Job.Info[] }` through the existing background view. Omitted/false descendants selects direct owners; true includes the subtree. Existing HTTP listing is unchanged. `ctx.job.cancel({ parentID, jobID })` and `POST /api/experimental/job/:parentID/:jobID/cancel` permit directly owned shell/image Jobs and direct subagents to `cancelChild`. Capability: `jobControl`. Core owner: `job/control.ts`.
- Both cancellation APIs return `cancelled` only after actual execution and cleanup settle, `terminal` with the existing terminal state, `requested` while accepted cleanup exceeds one second, or `unsupported` when the actual owner or native stop cannot be controlled. Accepted work continues in the host scope after caller deadlines. A nonlocal recovery claim is not an owner lease and remains unsupported.
- `Job.awaitIdle` includes native stop settlement registered before terminal publication, even for earlier waiters and consumed completion notices. Failed cleanup remains observable. `Shell.stop` captures the native process handle before command removal and awaits physical exit; repeated calls during SIGTERM escalation cannot claim terminal cancellation.
- Shared contracts live in Schema and Protocol; Promise/Effect adapters and generated clients preserve the same result union. Regenerate from `packages/client` after contract edits; never hand-edit generated output.

## Verification

- Parent native/messages/WAL run before final review corrections: 173 pass, 0 fail, 762 assertions. Parent final admission/recovery run: 9 pass, 0 fail, 44 assertions; earlier correction/native/group run: 30 pass, 0 fail, 131 assertions.
- Parent cancellation owner/HTTP/plugin run: 93 pass, 0 fail, 498 assertions. Final settlement/owner/plugin/HTTP subset after the early-waiter correction: 43 pass, 0 fail, 244 assertions. The two early-waiter cases failed on the unchanged owner before the ordering fix.
- Parent combined rebased candidate: 46 pass, 0 fail, 223 assertions across ten native/group/lifetime/message/plugin/cancellation files. Client generation's second run changed no bytes.
- Native and cancellation workers recorded failing owner mutations and exact source restoration. Regressions cover cross-model native compaction, more than twenty responses, implicit primary selection, competing child admissions, recovered idle/suspended groups, ownership refusal, real resistant-process escalation, consumed notices, failed stops and early waiters. Source reviews by [the retained reviewer](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3569b951ffeQp1HZhJCMdbdod) cleared every required finding after correction.
- Both mirrors published `ea2e468b5376f41ec58762b2d12d2cd07fcf35cc`; normal push hooks passed 34/34 workspace typechecks. The full canonical desktop build installed `opencode v2.2.7-vt-14-5f76acb125` from that clean source after a 12/12 runtime gate with no failures or skips. The linked delivery session owns exact paths and runtime evidence.
- The installed [v1 controller demonstration](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e37fc6aa2ffeItmFQYimsW3v7l) passed all four native API scenarios on its first run: forked background fan-out with one grouped notice, durable todo recovery after compaction, owned shell listing/physical stop, and child cancellation with ownership/generic-kind refusals. Evidence: `.vibeterm/tmp/opencode/w1-native-wz4788/result.json`. All owned demo processes stopped.

## Timeline

- 2026-11-10 [foundation session](../sessions/2026-11-10-v2-foundation.md) established the guarded v2 base used by these APIs.
- 2026-11-13 [delivery session](../sessions/2026-11-13-v2-plugin-controls.md), [W1](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3832b1b0ffe6q98OeUzhgqhjQ), resumed the paused work, closed review findings, and integrated the native and cancellation patches without rewriting `v2-nowaker`. That record owns mirror and installed-runtime receipts.
