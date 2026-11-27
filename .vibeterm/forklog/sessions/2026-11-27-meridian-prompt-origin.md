# Meridian attribution for OMO-originated v1 prompts

- Workday: 2026-11-27 (America/Los_Angeles).
- Source session: [`ses_de4d605ccffecLmNULfaQ6RQTh`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_de4d605ccffecLmNULfaQ6RQTh). Review: [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv).
- OpenCode `dev-nowaker`: reviewed source [`31050fb6244`](https://gitlab.com/vibeterm/opencode/-/commit/31050fb62445ee9b3552ad68453ba13bc8b055ec), task base `bac5fbe3db`, integration merge [`6d2faedaa0`](https://gitlab.com/vibeterm/opencode/-/commit/6d2faedaa0314b11a9614b2e2119ec900d8ecb70) on `8920ee86ce`. OMO companion [`713b9f5c46`](https://github.com/Nowaker/oh-my-openagent/commit/713b9f5c46a1365a4ec9e6307da43fca39fa79a5) has the same source tree as reviewed feature [`738341b704`](https://github.com/Nowaker/oh-my-openagent/commit/738341b704b926599197ff04b4b067648847800f).

## User request

> GOAL: Meridian request attribution for work OMO itself originates. Today the OpenCode fork (dev-nowaker, v1 packages/opencode/src/provider/meridian-attribution.ts) tags every request to a trusted Meridian endpoint with x-meridian-client opencode/<version>, x-meridian-purpose (chat|title|compaction|summary|subagent|review|helper|test), a fallback x-meridian-session and x-meridian-device. Missing: OMO-originated work tagged x-meridian-client oh-my-openagent/<version> with the right purpose.

## Behavior and verification

- The v1 API admits `promptOrigin` on the specific work-bearing user message. The value has a fixed client literal, bounded version syntax, and a closed purpose set. Missing or malformed input keeps existing attribution. A native `PluginInput.promptOrigin: 1` advertises support; unsupported engines get the previous prompt dispatch. There is no health capability endpoint or native v2 activation change.
- OMO marks delegated or teammate work and explicit task resumes as `subagent`, and `look_at` as `helper`. There is no OMO `review` producer. OpenCode alone writes Meridian headers at its exact approved HTTP inference endpoint. The origin is not sent in model input; title and compaction requests keep engine attribution.
- Tool continuation, retry, SQLite reopen, mutable plugin history, and protected compaction marker ownership were tested. Compaction uses the selected engine-owned part even with an unowned sibling, so its synthetic continuation keeps the originating scope. A queued human follow-up does not inherit it.
- Desktop Bun 1.4.4: `bun typecheck` passed in `packages/opencode`; focused compaction selection tests passed 11/11; attribution and source-process tests passed 37/37. The final two-source loopback run recorded 13 requests: four OMO subagent, one OMO helper, six engine chat, one engine title and one engine compaction. The older-engine control matched its nine baseline rows with no stored origin or duplicate request. The loopback receipts used no live provider or credentials.
- OMO adapter verification: 71 focused and 44 adjacent tests passed; scoped adapter and shared-utils typechecks passed. Desktop evidence is retained from the managed QA checkout. The coordinator owns the OpenCode build/install and the OMO rebuild; neither was run for this source handoff.
